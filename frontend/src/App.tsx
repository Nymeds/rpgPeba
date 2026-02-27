import { type FormEvent, useEffect, useMemo, useState } from "react";

import { autenticarConta, carregarSessao, criarPersonagem, registrarConta } from "./api";
import GameCanvas from "./game/GameCanvas";
import { useGameSocket } from "./game/useGameSocket";
import type { Account, AuthResponse, Character } from "./types";

type AuthMode = "login" | "register";

const TOKEN_KEY = "rpg-peba-jwt";

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
    return "Faça login para entrar no mundo.";
  }

  if (!character) {
    return `Conta @${account.username} ativa. Falta criar seu personagem.`;
  }

  return `Logado como @${account.username} com ${character.name}.`;
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => lerTokenSalvo());
  const [account, setAccount] = useState<Account | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [sessionBooting, setSessionBooting] = useState<boolean>(Boolean(lerTokenSalvo()));

  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [characterName, setCharacterName] = useState("");

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Pronto para conectar.");

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
        setNotice("Faça login para entrar no mundo.");
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
        setNotice("Sessão expirada. Faça login novamente.");
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

  const socketEnabled = Boolean(token && character);
  const gameSocket = useGameSocket(token, socketEnabled);
  const selfPlayerId = gameSocket.session?.playerId ?? character?.id ?? null;

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
      setNotice("Preencha usuário e senha.");
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
        authMode === "login" ? await autenticarConta(credentials) : await registrarConta(credentials);

      aplicarRespostaAuth(response);
      setPassword("");
    } catch (error) {
      console.error(error);
      setNotice(error instanceof Error ? error.message : "Falha de autenticação.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCharacter(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!token) {
      setNotice("Token ausente. Faça login novamente.");
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

  function logout(): void {
    limparToken();
    setToken(null);
    setAccount(null);
    setCharacter(null);
    setUsername("");
    setPassword("");
    setCharacterName("");
    setNotice("Logout feito.");
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">RPG Peba MMO Prototype</p>
        <h1>Mapa em tempo real com JWT + Socket.IO</h1>
        <div className="status-bar">
          <span>{notice}</span>
          <span>{socketStatusLabel}</span>
        </div>
      </header>

      {sessionBooting ? (
        <section className="panel card-center">
          <h2>Restaurando sessão</h2>
          <p>Validando token salvo e buscando seus dados...</p>
        </section>
      ) : null}

      {!sessionBooting && !token ? (
        <section className="panel card-center">
          <h2>{authMode === "login" ? "Entrar na conta" : "Criar conta"}</h2>
          <form onSubmit={onSubmitAuth} className="stack-form">
            <label htmlFor="username">Usuário</label>
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

            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Aguarde..." : authMode === "login" ? "Entrar" : "Registrar"}
            </button>
          </form>

          <button
            type="button"
            className="btn-link"
            onClick={() => setAuthMode((mode) => (mode === "login" ? "register" : "login"))}
          >
            {authMode === "login" ? "Não tem conta? Registrar" : "Já tem conta? Fazer login"}
          </button>
        </section>
      ) : null}

      {!sessionBooting && token && !character ? (
        <section className="panel card-center">
          <h2>Criar personagem</h2>
          <p>Uma conta só pode ter um personagem neste protótipo.</p>

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
        <main className="game-layout">
          <section className="panel info-panel">
            <h2>Jogador</h2>
            <p>
              <strong>Conta:</strong> @{account?.username}
            </p>
            <p>
              <strong>Personagem:</strong> {character.name}
            </p>
            <p>
              <strong>HP:</strong> {character.hp}/{character.maxHp}
            </p>
            <p>
              <strong>Instruções:</strong> WASD ou setas para andar.
            </p>
            <button type="button" className="btn-ghost" onClick={logout}>
              Logout
            </button>
            {gameSocket.error ? <small className="error-text">Socket: {gameSocket.error}</small> : null}
          </section>

          <section className="game-stage">
            <GameCanvas world={gameSocket.world} selfPlayerId={selfPlayerId} onMove={gameSocket.sendMove} />
          </section>
        </main>
      ) : null}
    </div>
  );
}
