// Tecnico: Hooks e tipos base do React para estado, efeitos e memoizacao.
// Crianca: Ferramentas para lembrar dados e reagir quando algo muda.
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

// Tecnico: Tipo do socket client para guardar referencia com tipagem forte.
// Crianca: Molde da conexao em tempo real.
import type { Socket } from "socket.io-client";

// Tecnico: Funcoes REST da API.
// Crianca: Comandos para cadastro, login e criacao de heroi.
import { criarPersonagem, buscarMinhaConta, entrarConta, cadastrarConta } from "./api";

// Tecnico: Fabrica do socket autenticado.
// Crianca: Botao para abrir o canal em tempo real.
import { criarSocketJogo } from "./socket";

// Tecnico: Tipos de eventos e dados de jogo.
// Crianca: Regras do formato das mensagens e jogadores.
import type {
  ClientToServerEvents,
  Direction,
  Player,
  ServerToClientEvents,
  SocketAck
} from "./types";
import idleSprite from "./assets/warrior/idle.gif";
import runSprite from "./assets/warrior/run.gif";

// Tecnico: Tamanho do mapa exibido no frontend.
// Crianca: Mapa tem 20 por 20 quadradinhos.
const MAP_SIZE = 20;
const CAMERA_VIEW_SIZE = 11;

// Tecnico: Chave usada no localStorage para token JWT.
// Crianca: Nome da gaveta onde guardamos o cracha.
const TOKEN_KEY = "rpgpeba_token";

// Tecnico: Mensagem padrao de ajuda ao usuario.
// Crianca: Dica de como jogar.
const DEFAULT_INFO =
  "Controles: W A S D para mover, Espaco para ataque rapido e clique em inimigo para ataque direcionado.";

// Tecnico: Telas possiveis do fluxo.
// Crianca: Paginas do app: entrar, criar heroi ou jogar.
type Screen = "auth" | "character" | "game";

// Tecnico: Modos do formulario de autenticacao.
// Crianca: Botao alterna entre entrar e cadastrar.
type AuthMode = "login" | "register";

type DirecaoHorizontal = "left" | "right";

type EstadoVisualJogador = {
  facing: DirecaoHorizontal;
  isMoving: boolean;
};

const SPRITE_MOVE_TIMEOUT_MS = 180;

function obterMensagemErro(error: unknown): string {
  // Tecnico: Normaliza erro desconhecido para string amigavel.
  // Crianca: Transforma qualquer erro em frase que da para ler.
  if (error instanceof Error) {
    return error.message;
  }
  return "Erro inesperado.";
}

function obterDirecaoDaTecla(key: string): Direction | null {
  // Tecnico: Mapeia tecla pressionada para direcao de movimento.
  // Crianca: Traduz W A S D para cima, esquerda, baixo e direita.
  switch (key.toLowerCase()) {
    case "w":
      return "up";
    case "s":
      return "down";
    case "a":
      return "left";
    case "d":
      return "right";
    default:
      return null;
  }
}

function obterInventarioVazio(): Array<string | null> {
  // Tecnico: Inventario fallback usado antes de receber estado real.
  // Crianca: Mochila vazia padrao.
  return Array.from({ length: 6 }, () => null);
}

function limitarNumero(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function agruparJogadoresPorCelula(players: Player[]): Map<string, Player[]> {
  // Tecnico: Agrupa jogadores por coordenada para renderizar o grid sem busca cara por celula.
  // Crianca: Junta os jogadores por quadradinho do mapa.
  const map = new Map<string, Player[]>();

  for (const player of players) {
    const key = `${player.x},${player.y}`;
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(player);
    } else {
      map.set(key, [player]);
    }
  }

  return map;
}

function obterDirecaoHorizontal(
  jogadorAnterior: Player | undefined,
  jogadorAtual: Player,
  fallback: DirecaoHorizontal
): DirecaoHorizontal {
  if (!jogadorAnterior) {
    return fallback;
  }
  if (jogadorAtual.x < jogadorAnterior.x) {
    return "left";
  }
  if (jogadorAtual.x > jogadorAnterior.x) {
    return "right";
  }
  return fallback;
}

function houveMovimento(jogadorAnterior: Player | undefined, jogadorAtual: Player): boolean {
  if (!jogadorAnterior) {
    return false;
  }
  return jogadorAnterior.x !== jogadorAtual.x || jogadorAnterior.y !== jogadorAtual.y;
}

export default function Aplicativo() {
  // Tecnico: Controle de qual tela esta ativa.
  // Crianca: Diz se estamos na tela de login, criacao ou jogo.
  const [screen, setScreen] = useState<Screen>("auth");

  // Tecnico: Alternancia entre login e cadastro.
  // Crianca: Decide qual formulario mostrar.
  const [authMode, setAuthMode] = useState<AuthMode>("login");

  // Tecnico: Flag para travar botoes durante requisicoes.
  // Crianca: Evita clicar mil vezes enquanto carrega.
  const [busy, setBusy] = useState(false);

  // Tecnico: Campos do formulario de autenticacao.
  // Crianca: Texto digitado em usuario e senha.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Tecnico: Campo de nome do personagem.
  // Crianca: Nome que vai para o heroi.
  const [characterName, setCharacterName] = useState("");

  // Tecnico: Token inicial vem do localStorage para sessao persistente.
  // Crianca: Se ja tinha cracha salvo, entra direto.
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");

  // Tecnico: Nome da conta logada mostrado no HUD.
  // Crianca: Nome do dono da conta.
  const [accountUsername, setAccountUsername] = useState("");

  // Tecnico: Lista de jogadores recebida do socket.
  // Crianca: Pessoas que aparecem no mapa.
  const [players, setPlayers] = useState<Player[]>([]);

  // Tecnico: Id do proprio personagem para destacar no grid.
  // Crianca: Numero do seu heroi.
  const [selfCharacterId, setSelfCharacterId] = useState<number | null>(null);

  // Tecnico: Barra de status/feedback ao usuario.
  // Crianca: Mensagem que explica o que esta acontecendo.
  const [infoMessage, setInfoMessage] = useState(DEFAULT_INFO);

  // Tecnico: Historico curto de combate.
  // Crianca: Diario das ultimas pancadas.
  const [combatLog, setCombatLog] = useState<string[]>([]);

  const [estadoVisualJogadores, setEstadoVisualJogadores] = useState<Record<number, EstadoVisualJogador>>({});

  // Tecnico: Referencia mutavel para socket ativo entre renders.
  // Crianca: Guarda o fio da conexao para usar depois.
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const jogadoresAnterioresRef = useRef<Map<number, Player>>(new Map());
  const timeoutsMovimentoRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const limparTimeoutMovimento = useCallback((playerId: number) => {
    const timeoutId = timeoutsMovimentoRef.current.get(playerId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutsMovimentoRef.current.delete(playerId);
    }
  }, []);

  const agendarRetornoIdle = useCallback(
    (playerId: number) => {
      limparTimeoutMovimento(playerId);
      const timeoutId = setTimeout(() => {
        setEstadoVisualJogadores((atual) => {
          const estadoJogador = atual[playerId];
          if (!estadoJogador || !estadoJogador.isMoving) {
            return atual;
          }
          return {
            ...atual,
            [playerId]: {
              ...estadoJogador,
              isMoving: false
            }
          };
        });
        timeoutsMovimentoRef.current.delete(playerId);
      }, SPRITE_MOVE_TIMEOUT_MS);
      timeoutsMovimentoRef.current.set(playerId, timeoutId);
    },
    [limparTimeoutMovimento]
  );

  const limparTodosTimeoutsMovimento = useCallback(() => {
    for (const timeoutId of timeoutsMovimentoRef.current.values()) {
      clearTimeout(timeoutId);
    }
    timeoutsMovimentoRef.current.clear();
  }, []);

  const desconectarSocket = useCallback(() => {
    // Tecnico: Fecha conexao socket atual e limpa referencia.
    // Crianca: Desliga o fio da internet em tempo real.
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  const sairDaConta = useCallback(
    (message?: string) => {
      // Tecnico: Limpa estado de sessao e volta para tela de autenticacao.
      // Crianca: Sai da conta e volta para o comeco.
      desconectarSocket();
      setToken("");
      setScreen("auth");
      setAccountUsername("");
      setPlayers([]);
      setSelfCharacterId(null);
      setEstadoVisualJogadores({});
      jogadoresAnterioresRef.current.clear();
      limparTodosTimeoutsMovimento();
      localStorage.removeItem(TOKEN_KEY);
      if (message) {
        setInfoMessage(message);
      }
    },
    [desconectarSocket, limparTodosTimeoutsMovimento]
  );

  useEffect(() => {
    return () => {
      limparTodosTimeoutsMovimento();
    };
  }, [limparTodosTimeoutsMovimento]);

  useEffect(() => {
    // Tecnico: Sem token, garante fluxo na tela de autenticacao.
    // Crianca: Sem cracha, fica na porta de entrada.
    if (!token) {
      setScreen("auth");
      return;
    }

    // Tecnico: Flag para evitar setState apos desmontar efeito.
    // Crianca: Trava para nao mexer na tela depois que sair.
    let cancelled = false;
    setBusy(true);

    // Tecnico: Reidrata sessao chamando /api/auth/me.
    // Crianca: Pergunta ao servidor quem esta logado.
    void buscarMinhaConta(token)
      .then((payload) => {
        if (cancelled) {
          return;
        }

        // Tecnico: Atualiza dados da conta e escolhe proxima tela.
        // Crianca: Se ja tem heroi vai para jogo, senao vai criar heroi.
        setAccountUsername(payload.account.username);
        if (payload.character) {
          setSelfCharacterId(payload.character.id);
          setScreen("game");
        } else {
          setSelfCharacterId(null);
          setScreen("character");
        }
        setInfoMessage(DEFAULT_INFO);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        sairDaConta(`Sessao invalida: ${obterMensagemErro(error)}`);
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, sairDaConta]);

  useEffect(() => {
    // Tecnico: Socket so existe dentro da tela de jogo e com token valido.
    // Crianca: Canal em tempo real so liga quando voce entra no mapa.
    if (screen !== "game" || !token) {
      desconectarSocket();
      jogadoresAnterioresRef.current.clear();
      limparTodosTimeoutsMovimento();
      setEstadoVisualJogadores({});
      return;
    }

    // Tecnico: Abre conexao socket autenticada.
    // Crianca: Conecta no mundo online.
    const socket = criarSocketJogo(token);
    socketRef.current = socket;

    // Tecnico: Evento inicial enviado pelo servidor.
    // Crianca: Mensagem "pronto, voce esta conectado".
    socket.on("world:ready", (payload) => {
      setSelfCharacterId(payload.characterId);
    });

    // Tecnico: Atualiza lista de jogadores sempre que o servidor envia snapshot.
    // Crianca: Redesenha quem esta no mapa em tempo real.
    socket.on("world:update", (payload) => {
      setPlayers(payload.players);
      const jogadoresAnteriores = jogadoresAnterioresRef.current;
      const jogadoresQueMoveram = payload.players
        .filter((player) => houveMovimento(jogadoresAnteriores.get(player.id), player))
        .map((player) => player.id);
      const idsJogadoresQueMoveram = new Set(jogadoresQueMoveram);

      const idsAtuais = new Set(payload.players.map((player) => player.id));
      for (const playerId of [...timeoutsMovimentoRef.current.keys()]) {
        if (!idsAtuais.has(playerId)) {
          limparTimeoutMovimento(playerId);
        }
      }

      setEstadoVisualJogadores((estadoAtual) => {
        const proximosEstados: Record<number, EstadoVisualJogador> = {};

        for (const player of payload.players) {
          const jogadorAnterior = jogadoresAnteriores.get(player.id);
          const estadoAnterior = estadoAtual[player.id];
          const facing = obterDirecaoHorizontal(jogadorAnterior, player, estadoAnterior?.facing ?? "right");
          const isMoving = idsJogadoresQueMoveram.has(player.id) || Boolean(estadoAnterior?.isMoving);

          proximosEstados[player.id] = {
            facing,
            isMoving
          };
        }

        return proximosEstados;
      });
      jogadoresAnterioresRef.current = new Map(payload.players.map((player) => [player.id, player]));
      for (const playerId of jogadoresQueMoveram) {
        agendarRetornoIdle(playerId);
      }
    });

    // Tecnico: Adiciona eventos de combate ao topo do log.
    // Crianca: Guarda as ultimas lutas em uma lista.
    socket.on("combat:event", (payload) => {
      const eventText = payload.defeated
        ? `Jogador #${payload.attackerId} derrotou #${payload.targetId}`
        : `Jogador #${payload.attackerId} causou ${payload.damage} em #${payload.targetId}`;

      setCombatLog((current) => [eventText, ...current].slice(0, 8));
    });

    // Tecnico: Captura erro de conexao no socket para feedback.
    // Crianca: Se o fio cair, mostra aviso.
    socket.on("connect_error", () => {
      setInfoMessage("Falha na conexao WebSocket.");
    });

    return () => {
      // Tecnico: Limpa socket ao sair da tela de jogo ou trocar token.
      // Crianca: Desliga o canal quando nao estiver jogando.
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      jogadoresAnterioresRef.current.clear();
      limparTodosTimeoutsMovimento();
    };
  }, [screen, token, desconectarSocket, agendarRetornoIdle, limparTimeoutMovimento, limparTodosTimeoutsMovimento]);

  const enviarMovimento = useCallback((direction: Direction) => {
    // Tecnico: Lanca comando de movimento via socket com callback de erro.
    // Crianca: Pede para andar e escuta se deu certo.
    const socket = socketRef.current;
    if (!socket) {
      return;
    }

    if (selfCharacterId) {
      setEstadoVisualJogadores((atual) => {
        const estadoAnterior = atual[selfCharacterId] ?? { facing: "right", isMoving: false };
        const facing = direction === "left" ? "left" : direction === "right" ? "right" : estadoAnterior.facing;
        return {
          ...atual,
          [selfCharacterId]: {
            facing,
            isMoving: true
          }
        };
      });
      agendarRetornoIdle(selfCharacterId);
    }

    const ack: SocketAck = (response) => {
      if (!response.ok && response.error) {
        setInfoMessage(response.error);
      }
    };

    socket.emit("player:move", { direction }, ack);
  }, [selfCharacterId, agendarRetornoIdle]);

  const enviarAtaque = useCallback((targetId?: number) => {
    // Tecnico: Emite ataque livre ou direcionado para targetId.
    // Crianca: Ataca perto com espaco ou clica para bater em alguem especifico.
    const socket = socketRef.current;
    if (!socket) {
      return;
    }

    const ack: SocketAck = (response) => {
      if (!response.ok && response.error) {
        setInfoMessage(response.error);
      }
    };

    if (targetId) {
      socket.emit("player:attack", { targetId }, ack);
    } else {
      socket.emit("player:attack", {}, ack);
    }
  }, []);

  useEffect(() => {
    // Tecnico: Atalhos de teclado so valem na tela de jogo.
    // Crianca: Teclas de andar e atacar so funcionam quando esta no mapa.
    if (screen !== "game") {
      return;
    }

    const aoPressionarTecla = (event: KeyboardEvent) => {
      const direction = obterDirecaoDaTecla(event.key);
      if (direction) {
        event.preventDefault();
        enviarMovimento(direction);
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        enviarAtaque();
      }
    };

    window.addEventListener("keydown", aoPressionarTecla);
    return () => {
      window.removeEventListener("keydown", aoPressionarTecla);
    };
  }, [screen, enviarMovimento, enviarAtaque]);

  // Tecnico: Resolve "quem sou eu" dentro da lista de players.
  // Crianca: Encontra seu heroi entre todos do mapa.
  const jogadorAtual = useMemo(
    () => players.find((player) => player.id === selfCharacterId) ?? null,
    [players, selfCharacterId]
  );

  // Tecnico: Indexa jogadores por celula para renderizar grid de forma eficiente.
  // Crianca: Organiza por quadradinho para achar rapido quem esta onde.
  const jogadoresPorCelula = useMemo(() => agruparJogadoresPorCelula(players), [players]);

  const origemCamera = useMemo(() => {
    const meio = Math.floor(CAMERA_VIEW_SIZE / 2);
    const limite = Math.max(0, MAP_SIZE - CAMERA_VIEW_SIZE);
    if (!jogadorAtual) {
      return { x: 0, y: 0 };
    }
    return {
      x: limitarNumero(jogadorAtual.x - meio, 0, limite),
      y: limitarNumero(jogadorAtual.y - meio, 0, limite)
    };
  }, [jogadorAtual]);

  const aoEnviarAutenticacao = async (event: FormEvent<HTMLFormElement>) => {
    // Tecnico: Intercepta submit para fluxo SPA.
    // Crianca: Impede a pagina de recarregar ao clicar em entrar.
    event.preventDefault();
    if (busy) {
      return;
    }

    // Tecnico: Normaliza username e valida campos obrigatorios.
    // Crianca: Arruma o nome e checa se preencheu tudo.
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername || !password) {
      setInfoMessage("Preencha usuario e senha.");
      return;
    }

    setBusy(true);
    try {
      // Tecnico: Escolhe endpoint conforme modo login/cadastro.
      // Crianca: Se estiver em cadastrar cria conta, senao entra.
      const payload =
        authMode === "register"
          ? await cadastrarConta(normalizedUsername, password)
          : await entrarConta(normalizedUsername, password);

      // Tecnico: Persiste token e atualiza estado local.
      // Crianca: Guarda cracha para nao precisar logar toda hora.
      localStorage.setItem(TOKEN_KEY, payload.token);
      setToken(payload.token);
      setAccountUsername(payload.account.username);
      setUsername("");
      setPassword("");
      setInfoMessage("Autenticacao concluida.");
    } catch (error: unknown) {
      setInfoMessage(obterMensagemErro(error));
    } finally {
      setBusy(false);
    }
  };

  const aoEnviarPersonagem = async (event: FormEvent<HTMLFormElement>) => {
    // Tecnico: Submit sem reload e com bloqueio em estado busy.
    // Crianca: Cria heroi sem recarregar a pagina.
    event.preventDefault();
    if (!token || busy) {
      return;
    }

    // Tecnico: Limpa espacos e valida nome obrigatorio.
    // Crianca: Verifica se nome do heroi foi digitado.
    const normalizedName = characterName.trim();
    if (!normalizedName) {
      setInfoMessage("Informe o nome do personagem.");
      return;
    }

    setBusy(true);
    try {
      // Tecnico: Chama API de criacao e avanca para o jogo.
      // Crianca: Cria o heroi e entra no mapa.
      const payload = await criarPersonagem(token, normalizedName);
      setCharacterName("");
      setSelfCharacterId(payload.character.id);
      setScreen("game");
      setInfoMessage("Personagem criado. Entrando no mundo...");
    } catch (error: unknown) {
      setInfoMessage(obterMensagemErro(error));
    } finally {
      setBusy(false);
    }
  };

  const celulasRenderizadas = useMemo(() => {
    // Tecnico: Gera camera local (11 x 11) presa no jogador atual.
    // Crianca: Mostra so a parte perto de voce e move junto quando voce anda.
    return Array.from({ length: CAMERA_VIEW_SIZE * CAMERA_VIEW_SIZE }, (_, index) => {
      const localX = index % CAMERA_VIEW_SIZE;
      const localY = Math.floor(index / CAMERA_VIEW_SIZE);
      const x = origemCamera.x + localX;
      const y = origemCamera.y + localY;

      // Tecnico: Recupera jogadores presentes nessa celula.
      // Crianca: Vê quem esta em cima desse quadrado.
      const cellPlayers = jogadoresPorCelula.get(`${x},${y}`) ?? [];
      const selfOnTile = cellPlayers.find((player) => player.id === selfCharacterId);
      const enemyOnTile = cellPlayers.find((player) => player.id !== selfCharacterId);
      const hasPlayer = cellPlayers.length > 0;

      // Tecnico: Classe CSS dinamica por tipo de ocupacao.
      // Crianca: Cor muda se for voce ou inimigo.
      let cellClassName = "cell";
      if (selfOnTile) {
        cellClassName += " self";
      } else if (enemyOnTile) {
        cellClassName += " enemy";
      }

      const jogadorRenderizado = selfOnTile ?? enemyOnTile ?? null;
      const estadoVisual = jogadorRenderizado ? estadoVisualJogadores[jogadorRenderizado.id] : undefined;
      const spriteAtual = estadoVisual?.isMoving ? runSprite : idleSprite;
      const flipParaEsquerda = estadoVisual?.facing === "left";
      const tooltip = hasPlayer
        ? cellPlayers.map((player) => `${player.name} (${player.hp}/${player.maxHp})`).join(" | ")
        : `Tile ${x},${y}`;

      return (
        <button
          key={`${x}-${y}`}
          type="button"
          className={cellClassName}
          title={tooltip}
          onClick={() => {
            // Tecnico: Clique em celula com inimigo envia ataque direcionado.
            // Crianca: Clicou no inimigo, bate nele.
            if (enemyOnTile) {
              enviarAtaque(enemyOnTile.id);
            }
          }}
        >
          {jogadorRenderizado ? (
            <img
              src={spriteAtual}
              alt={jogadorRenderizado.name}
              className={`player-sprite${flipParaEsquerda ? " flip-left" : ""}`}
              draggable={false}
            />
          ) : null}
          {selfOnTile ? <span className="cell-tag">YOU</span> : null}
          {!selfOnTile && enemyOnTile ? <span className="cell-tag">ATK</span> : null}
        </button>
      );
    });
  }, [jogadoresPorCelula, selfCharacterId, enviarAtaque, estadoVisualJogadores, origemCamera]);

  return (
    <div className="app">
      <header className="hero">
        <div>
          <h1>RPG Peba</h1>
          <p>MMORPG 2D topdown com Fastify, Socket.IO, Prisma e React.</p>
        </div>

        {screen === "game" ? (
          <button className="ghost-button" type="button" onClick={() => sairDaConta("Sessao encerrada.")}>
            Sair
          </button>
        ) : null}
      </header>

      {screen === "auth" ? (
        <section className="panel auth-panel">
          <h2>{authMode === "login" ? "Entrar na conta" : "Criar conta"}</h2>

          <form onSubmit={aoEnviarAutenticacao}>
            <label htmlFor="username">Usuario</label>
            <input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Ex.: peba123"
              autoComplete="username"
            />

            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minimo 6 caracteres"
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
            />

            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Carregando..." : authMode === "login" ? "Entrar" : "Cadastrar"}
            </button>
          </form>

          <button
            className="link-button"
            type="button"
            onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
          >
            {authMode === "login" ? "Nao tenho conta" : "Ja tenho conta"}
          </button>
        </section>
      ) : null}

      {screen === "character" ? (
        <section className="panel">
          <h2>Criar personagem</h2>
          <p>Conta: {accountUsername}</p>

          <form onSubmit={aoEnviarPersonagem}>
            <label htmlFor="character">Nome do personagem</label>
            <input
              id="character"
              value={characterName}
              onChange={(event) => setCharacterName(event.target.value)}
              placeholder="Ex.: Guerreiro Peba"
            />

            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Criando..." : "Criar personagem"}
            </button>
          </form>
        </section>
      ) : null}

      {screen === "game" ? (
        <section className="panel game-panel">
          <div className="game-layout">
            <div className="world-wrap">
              <div className="camera-title">
                Camera [{origemCamera.x},{origemCamera.y}] - foco em {jogadorAtual?.name ?? "carregando"}
              </div>
              <div className="world-grid">{celulasRenderizadas}</div>
            </div>

            <aside className="hud">
              <div className="card">
                <h3>Jogador</h3>
                <p>Conta: {accountUsername}</p>
                <p>
                  {jogadorAtual
                    ? `${jogadorAtual.name} | HP ${jogadorAtual.hp}/${jogadorAtual.maxHp}`
                    : "Aguardando estado do mundo..."}
                </p>
              </div>

              <div className="card">
                <h3>Inventario (6 slots)</h3>
                <div className="inventory-grid">
                  {(jogadorAtual?.inventory ?? obterInventarioVazio()).map((slot, index) => (
                    <div className="slot" key={index}>
                      {slot ?? "--"}
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <h3>Online ({players.length})</h3>
                <ul className="compact-list">
                  {players.map((player) => (
                    <li key={player.id}>
                      {player.name} [{player.x},{player.y}] HP {player.hp}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card">
                <h3>Combate</h3>
                <ul className="compact-list">
                  {combatLog.length === 0 ? <li>Sem eventos ainda.</li> : null}
                  {combatLog.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </section>
      ) : null}

      <footer className="status-bar">{infoMessage}</footer>
    </div>
  );
}

