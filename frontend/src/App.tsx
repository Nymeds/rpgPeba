import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { autenticarConta, carregarMapa, carregarSessao, criarPersonagem, registrarConta, salvarMapa } from "./api";
import MapEditor from "./game/MapEditor";
import GameCanvas from "./game/GameCanvas";
import { useGameSocket } from "./game/useGameSocket";
import monkIdleGif from "../images/Monk/idle.gif";
import warriorIdleGif from "../images/Warrior/idle.gif";
import {
  PlayerType,
  type Account,
  type AuthResponse,
  type Character,
  type GameMapDefinition,
  type PublicPlayer
} from "./types";

type AuthMode = "login" | "register";

const TOKEN_KEY = "rpg-peba-jwt";
const CHAT_MAX_LENGTH = 220;

function salvarToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

function lerTokenSalvo(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function limparToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function statusSessao(account: Account | null, character: Character | null): string {
  if (!account) {
    return "Faca login para entrar no mundo.";
  }

  if (!character) {
    return `Conta @${account.username} ativa (${rotuloClasse(account.playerType)}). Falta criar seu personagem.`;
  }

  return `Logado como @${account.username} com ${character.name} (${rotuloClasse(character.playerType)}).`;
}

function rotuloClasse(playerType: PlayerType): string {
  return playerType === PlayerType.MONK ? "Monk" : "Knight";
}

function formatarHora(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function hpPercent(player: Pick<PublicPlayer, "hp" | "maxHp">): number {
  if (player.maxHp <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((player.hp / player.maxHp) * 100)));
}

function mapPercent(value: number, mapSize: number): number {
  const divisor = Math.max(1, mapSize - 1);
  const percent = (value / divisor) * 100;
  return Math.max(0, Math.min(100, percent));
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => lerTokenSalvo());
  const [account, setAccount] = useState<Account | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [sessionBooting, setSessionBooting] = useState<boolean>(Boolean(lerTokenSalvo()));

  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedPlayerType, setSelectedPlayerType] = useState<PlayerType>(PlayerType.WARRIOR);
  const [characterName, setCharacterName] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [worldMap, setWorldMap] = useState<GameMapDefinition | null>(null);
  const [mapEditorOpen, setMapEditorOpen] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [showGrid, setShowGrid] = useState(false);

  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [notice, setNotice] = useState("Pronto para conectar.");

  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const lastLoadedMapRevisionRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      if (!token) {
        if (!active) {
          return;
        }
        setSessionBooting(false);
        setAccount(null);
        setCharacter(null);
        setNotice("Faca login para entrar no mundo.");
        return;
      }

      setSessionBooting(true);
      setNotice("Validando JWT salvo...");

      try {
        const response = await carregarSessao(token);
        if (!active) {
          return;
        }
        setAccount(response.account);
        setCharacter(response.character);
        setNotice(statusSessao(response.account, response.character));
      } catch (error) {
        if (!active) {
          return;
        }
        console.error(error);
        limparToken();
        setToken(null);
        setAccount(null);
        setCharacter(null);
        setNotice("Sessao expirada. Faca login novamente.");
      } finally {
        if (active) {
          setSessionBooting(false);
        }
      }
    }

    void restoreSession();
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    let active = true;

    async function loadMapFromApi() {
      if (!token) {
        if (!active) {
          return;
        }
        setWorldMap(null);
        setMapEditorOpen(false);
        return;
      }

      try {
        const response = await carregarMapa(token);
        if (!active) {
          return;
        }
        setWorldMap(response.map);
      } catch (error) {
        if (!active) {
          return;
        }
        console.error(error);
        setNotice(error instanceof Error ? error.message : "Falha ao carregar mapa.");
      }
    }

    void loadMapFromApi();
    return () => {
      active = false;
    };
  }, [token]);

  const socketEnabled = Boolean(token && character);
  const gameSocket = useGameSocket(token, socketEnabled);
  const selfPlayerId = gameSocket.session?.playerId ?? character?.id ?? null;
  const worldMapRevision = gameSocket.world?.mapRevision ?? null;

  useEffect(() => {
    lastLoadedMapRevisionRef.current = null;
  }, [token]);

  useEffect(() => {
    let active = true;

    async function syncMapByRevision() {
      if (!token || worldMapRevision === null) {
        return;
      }

      if (lastLoadedMapRevisionRef.current === worldMapRevision) {
        return;
      }

      lastLoadedMapRevisionRef.current = worldMapRevision;
      try {
        const response = await carregarMapa(token);
        if (!active) {
          return;
        }
        setWorldMap(response.map);
      } catch (error) {
        console.error(error);
        if (!active) {
          return;
        }
        setNotice(error instanceof Error ? error.message : "Falha ao sincronizar mapa atualizado.");
      }
    }

    void syncMapByRevision();
    return () => {
      active = false;
    };
  }, [token, worldMapRevision]);

  useEffect(() => {
    const node = chatLogRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [gameSocket.chatMessages.length]);

  const socketStatusLabel = useMemo(() => {
    if (!socketEnabled) {
      return "socket inativo";
    }
    if (gameSocket.status === "connecting") {
      return "socket conectando";
    }
    if (gameSocket.status === "connected") {
      return "socket online";
    }
    if (gameSocket.status === "error") {
      return "socket com erro";
    }
    return "socket aguardando";
  }, [gameSocket.status, socketEnabled]);

  const worldPlayers = gameSocket.world?.players ?? [];
  const sortedPlayers = useMemo(
    () => [...worldPlayers].sort((a, b) => a.name.localeCompare(b.name)),
    [worldPlayers]
  );
  const selfWorldPlayer = gameSocket.world?.players.find((player) => player.id === selfPlayerId) ?? null;
  const minimapSize = gameSocket.world?.mapSize ?? gameSocket.session?.mapSize ?? 1;

  function aplicarRespostaAuth(response: AuthResponse): void {
    salvarToken(response.token);
    setToken(response.token);
    setAccount(response.account);
    setCharacter(response.character);
    setNotice(statusSessao(response.account, response.character));
  }

  async function onSubmitAuth(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!username.trim() || !password.trim()) {
      setNotice("Preencha usuario e senha.");
      return;
    }

    setBusy(true);
    setNotice(authMode === "login" ? "Autenticando conta..." : "Criando conta...");

    try {
      const credentials = {
        username: username.trim(),
        password
      };

      const response =
        authMode === "login"
          ? await autenticarConta(credentials)
          : await registrarConta({
              ...credentials,
              playerType: selectedPlayerType
            });

      aplicarRespostaAuth(response);
      setPassword("");
    } catch (error) {
      console.error(error);
      setNotice(error instanceof Error ? error.message : "Falha de autenticacao.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCharacter(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!token) {
      setNotice("Token ausente. Faca login novamente.");
      return;
    }

    if (!characterName.trim()) {
      setNotice("Digite o nome do personagem.");
      return;
    }

    setBusy(true);
    setNotice("Criando personagem...");

    try {
      const response = await criarPersonagem(token, characterName.trim());
      setCharacter(response.character);
      setCharacterName("");
      setNotice(statusSessao(account, response.character));
    } catch (error) {
      console.error(error);
      setNotice(error instanceof Error ? error.message : "Falha ao criar personagem.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitChat(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const messageText = chatInput.trim();
    if (!messageText) {
      return;
    }

    if (messageText.toLowerCase() === "/edit") {
      setChatInput("");

      if (!token) {
        setNotice("Faca login para usar o editor.");
        return;
      }

      if (!worldMap) {
        setNotice("Carregando dados do mapa...");
        try {
          const mapResponse = await carregarMapa(token);
          setWorldMap(mapResponse.map);
        } catch (error) {
          console.error(error);
          setNotice(error instanceof Error ? error.message : "Falha ao abrir editor.");
          return;
        }
      }

      setMapEditorOpen((current) => {
        const next = !current;
        setNotice(next ? "Editor de mapa aberto (/edit para fechar)." : "Editor de mapa fechado.");
        return next;
      });
      return;
    }

    // Comando local de visualizacao:
    // /showgrid true -> mostra linhas
    // /showgrid false -> esconde linhas
    const [command, rawValue = ""] = messageText.trim().split(/\s+/, 2);
    if (command.toLowerCase() === "/showgrid") {
      setChatInput("");
      const normalizedValue = rawValue.toLowerCase();
      if (normalizedValue === "true") {
        setShowGrid(true);
        setNotice("Grid visual do mapa ativada.");
        return;
      }
      if (normalizedValue === "false") {
        setShowGrid(false);
        setNotice("Grid visual do mapa desativada.");
        return;
      }
      setNotice("Uso: /showgrid true ou /showgrid false");
      return;
    }

    if (!socketEnabled || chatBusy) {
      return;
    }

    setChatBusy(true);
    setChatInput("");

    try {
      const ack = await gameSocket.sendChat(messageText);
      if (!ack.ok) {
        setNotice(ack.error ?? "Nao foi possivel enviar no chat.");
        setChatInput(messageText);
      }
    } finally {
      setChatBusy(false);
    }
  }

  function logout(): void {
    limparToken();
    setToken(null);
    setAccount(null);
    setCharacter(null);
    setUsername("");
    setPassword("");
    setSelectedPlayerType(PlayerType.WARRIOR);
    setCharacterName("");
    setChatInput("");
    setWorldMap(null);
    setMapEditorOpen(false);
    setNotice("Logout feito.");
  }

  async function salvarMapaEditado(nextMap: Omit<GameMapDefinition, "updatedAt">): Promise<void> {
    if (!token) {
      throw new Error("Token ausente para salvar mapa.");
    }

    setMapBusy(true);
    try {
      const response = await salvarMapa(token, nextMap);
      setWorldMap(response.map);
      setNotice(`Mapa "${response.map.name}" salvo no banco.`);
    } finally {
      setMapBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">RPG Peba MMO Prototype</p>
        <h1>Sala realtime: jogo, chat, online e mini mapa</h1>
        <div className="status-bar">
          <span>{notice}</span>
          <span>{socketStatusLabel}</span>
        </div>
      </header>

      {sessionBooting ? (
        <section className="panel card-center">
          <h2>Restaurando sessao</h2>
          <p>Validando token salvo e buscando seus dados...</p>
        </section>
      ) : null}

      {!sessionBooting && !token ? (
        <section className="panel card-center">
          <h2>{authMode === "login" ? "Entrar na conta" : "Criar conta"}</h2>
          <form onSubmit={onSubmitAuth} className="stack-form">
            <label htmlFor="username">Usuario</label>
            <input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="ex.: peba_warrior"
              autoComplete="username"
            />

            <label htmlFor="password">Senha</label>
            <input
              id="password"
              value={password}
              type="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="minimo 6 caracteres"
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
            />

            {authMode === "register" ? (
              <fieldset className="class-picker" aria-label="Escolha sua classe">
                <legend>Escolha sua classe inicial</legend>
                <div className="class-picker-grid">
                  <button
                    type="button"
                    className={`class-option ${selectedPlayerType === PlayerType.WARRIOR ? "selected" : ""}`}
                    onClick={() => setSelectedPlayerType(PlayerType.WARRIOR)}
                  >
                    <img src={warriorIdleGif} alt="Knight idle" className="class-option-gif" />
                    <strong>Knight (Warrior)</strong>
                    <small>Ataque padrao corpo a corpo.</small>
                  </button>

                  <button
                    type="button"
                    className={`class-option ${selectedPlayerType === PlayerType.MONK ? "selected" : ""}`}
                    onClick={() => setSelectedPlayerType(PlayerType.MONK)}
                  >
                    <img src={monkIdleGif} alt="Monk idle" className="class-option-gif" />
                    <strong>Monk</strong>
                    <small>Cura aliados no lugar de causar dano.</small>
                  </button>
                </div>
              </fieldset>
            ) : null}

            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Aguarde..." : authMode === "login" ? "Entrar" : "Registrar"}
            </button>
          </form>

          <button
            type="button"
            className="btn-link"
            onClick={() => setAuthMode((mode) => (mode === "login" ? "register" : "login"))}
          >
            {authMode === "login" ? "Nao tem conta? Registrar" : "Ja tem conta? Fazer login"}
          </button>
        </section>
      ) : null}

      {!sessionBooting && token && !character ? (
        <section className="panel card-center">
          <h2>Criar personagem</h2>
          <p>Uma conta so pode ter um personagem neste prototipo.</p>
          <p>
            Classe selecionada no cadastro: <strong>{rotuloClasse(account?.playerType ?? PlayerType.WARRIOR)}</strong>
          </p>

          <form onSubmit={onSubmitCharacter} className="stack-form">
            <label htmlFor="charName">Nome do personagem</label>
            <input
              id="charName"
              value={characterName}
              onChange={(event) => setCharacterName(event.target.value)}
              placeholder="ex.: Guerreiro Peba"
              autoComplete="off"
            />

            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Criando..." : "Criar personagem"}
            </button>
          </form>

          <button type="button" className="btn-ghost" onClick={logout}>
            Sair da conta
          </button>
        </section>
      ) : null}

      {!sessionBooting && token && character ? (
        <>
        <main className="arena-layout">
          <aside className="panel players-panel">
            <div className="panel-head">
              <h2>Online</h2>
              <span>{sortedPlayers.length}</span>
            </div>

            <div className="players-list">
              {sortedPlayers.length === 0 ? <p className="empty-text">Aguardando jogadores...</p> : null}
              {sortedPlayers.map((player) => (
                <article
                  key={player.id}
                  className={`player-card ${player.id === selfPlayerId ? "self" : ""}`}
                >
                  <div className="player-card-top">
                    <strong>{player.name}</strong>
                    <small>
                      ({Math.round(player.x)}, {Math.round(player.y)})
                    </small>
                  </div>
                  <div className="hp-track">
                    <span style={{ width: `${hpPercent(player)}%` }} />
                  </div>
                </article>
              ))}
            </div>
          </aside>

          <section className="center-column">
            <section className="game-stage">
              <GameCanvas
                world={gameSocket.world}
                mapDefinition={worldMap}
                selfPlayerId={selfPlayerId}
                onMove={gameSocket.sendMove}
                onAttack={gameSocket.sendAttack}
                showGrid={showGrid}
              />
            </section>

            <section className="panel chat-panel">
              <div className="panel-head">
                <h2>Chat da sala</h2>
                <span>{gameSocket.chatMessages.length} msgs</span>
              </div>

              <div ref={chatLogRef} className="chat-log">
                {gameSocket.chatMessages.length === 0 ? (
                  <p className="empty-text">Ninguem falou ainda.</p>
                ) : (
                  gameSocket.chatMessages.map((message) => (
                    <p
                      key={message.id}
                      className={`chat-line ${message.playerId === selfPlayerId ? "self" : ""}`}
                    >
                      <span className="chat-meta">
                        [{formatarHora(message.createdAt)}] {message.playerName}
                      </span>
                      <span>{message.text}</span>
                    </p>
                  ))
                )}
              </div>

              <form onSubmit={onSubmitChat} className="chat-form">
                <input
                  value={chatInput}
                  maxLength={CHAT_MAX_LENGTH}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Digite e pressione Enter"
                  autoComplete="off"
                />
                <button type="submit" disabled={chatBusy || !chatInput.trim()} className="btn-primary">
                  {chatBusy ? "..." : "Enviar"}
                </button>
              </form>
            </section>
          </section>

          <aside className="right-column">
            <section className="panel minimap-panel">
              <div className="panel-head">
                <h2>Mini mapa</h2>
                <span>
                  {minimapSize}x{minimapSize}
                </span>
              </div>

              <div className="minimap-shell">
                {gameSocket.world ? (
                  <svg viewBox="0 0 100 100" role="img" aria-label="Mini mapa da sala">
                    <rect x="0" y="0" width="100" height="100" className="mini-border" />
                    {gameSocket.world.players.map((player) => (
                      <circle
                        key={player.id}
                        cx={mapPercent(player.x, gameSocket.world?.mapSize ?? 1)}
                        cy={mapPercent(player.y, gameSocket.world?.mapSize ?? 1)}
                        r={player.id === selfPlayerId ? 3.8 : 2.8}
                        className={player.id === selfPlayerId ? "mini-dot self" : "mini-dot"}
                      />
                    ))}
                  </svg>
                ) : (
                  <p className="empty-text">Aguardando snapshot...</p>
                )}
              </div>
            </section>

            <section className="panel session-panel">
              <h2>Sessao</h2>
              <p>
                <strong>Conta:</strong> @{account?.username}
              </p>
              <p>
                <strong>Personagem:</strong> {character.name}
              </p>
              <p>
                <strong>Classe:</strong> {rotuloClasse(character.playerType)}
              </p>
              <p>
                <strong>HP:</strong> {selfWorldPlayer?.hp ?? character.hp}/{selfWorldPlayer?.maxHp ?? character.maxHp}
              </p>
              <p>
                <strong>Controles:</strong> WASD/setas para mover.
              </p>
              <p>
                <strong>Ataque:</strong> clique no centro da arena para ativar mira; ataque com clique ou espaco.
              </p>
              <p>
                <strong>Habilidade:</strong> Warrior causa dano, Monk cura outros players.
              </p>
              <p>
                <strong>Editor:</strong> digite <code>/edit</code> no chat para abrir/fechar.
              </p>
              <p>
                <strong>Grid:</strong> <code>/showgrid true</code> ou <code>/showgrid false</code>.
              </p>

              <button type="button" className="btn-ghost" onClick={logout}>
                Logout
              </button>
              {gameSocket.error ? <small className="error-text">Socket: {gameSocket.error}</small> : null}
            </section>
          </aside>
        </main>
        {mapEditorOpen && worldMap ? (
          <section className="panel map-editor-panel-wrap">
            {mapBusy ? <p className="empty-text">Sincronizando mapa com o banco...</p> : null}
            <MapEditor
              map={worldMap}
              onSave={salvarMapaEditado}
              onClose={() => {
                setMapEditorOpen(false);
                setNotice("Editor de mapa fechado.");
              }}
            />
          </section>
        ) : null}
        </>
      ) : null}
    </div>
  );
}
