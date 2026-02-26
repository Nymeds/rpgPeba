import { type FormEvent, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import { criarSocketChat } from "./socket";
import type {
  ChatMessage,
  ClientToServerEvents,
  RoomSummary,
  ServerToClientEvents,
  SocketAck
} from "./types";

type Screen = "login" | "lobby" | "room";

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function Aplicativo() {
  const [screen, setScreen] = useState<Screen>("login");
  const [status, setStatus] = useState("Digite um nickname e conecte.");

  const [nicknameInput, setNicknameInput] = useState("");
  const [nickname, setNickname] = useState("");

  const [roomInput, setRoomInput] = useState("");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);

  const [roomName, setRoomName] = useState("");
  const [roomUsers, setRoomUsers] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");

  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const roomNameRef = useRef("");

  useEffect(() => {
    roomNameRef.current = roomName;
  }, [roomName]);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const limparSalaAtual = () => {
    setRoomName("");
    setRoomUsers([]);
    setMessages([]);
    setMessageInput("");
  };

  const fecharSocketAtual = () => {
    if (!socketRef.current) {
      return;
    }
    socketRef.current.removeAllListeners();
    socketRef.current.disconnect();
    socketRef.current = null;
  };

  const desconectarTudo = () => {
    fecharSocketAtual();
    setScreen("login");
    setNickname("");
    setRooms([]);
    limparSalaAtual();
    setStatus("Desconectado.");
  };

  const conectar = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nome = nicknameInput.trim();

    if (!nome) {
      setStatus("Digite um nickname valido.");
      return;
    }

    fecharSocketAtual();
    limparSalaAtual();
    setRooms([]);
    setStatus("Conectando no servidor...");

    const socket = criarSocketChat(nome);
    socketRef.current = socket;

    socket.on("session:ready", (payload) => {
      setNickname(payload.nickname);
      setRooms(payload.rooms);
      setScreen("lobby");
      setStatus(`Logado como @${payload.nickname}. Escolha uma sala.`);
      console.log(`[CLIENT] sessao pronta @${payload.nickname}`);
    });

    socket.on("room:list", (payload) => {
      setRooms(payload.rooms);
      console.log(`[CLIENT] salas atualizadas: ${payload.rooms.map((room) => room.name).join(", ")}`);
    });

    socket.on("room:joined", (payload) => {
      setRoomName(payload.roomName);
      setRoomUsers(payload.users);
      setMessages(payload.messages);
      setScreen("room");
      setStatus(`Voce entrou na sala ${payload.roomName}.`);
      console.log(`[CLIENT] entrou em ${payload.roomName}`);
    });

    socket.on("room:left", (payload) => {
      if (payload.roomName === roomNameRef.current) {
        limparSalaAtual();
      }
      setScreen("lobby");
      setStatus(`Voce saiu da sala ${payload.roomName}.`);
      console.log(`[CLIENT] saiu de ${payload.roomName}`);
    });

    socket.on("room:users", (payload) => {
      if (payload.roomName !== roomNameRef.current) {
        return;
      }
      setRoomUsers(payload.users);
    });

    socket.on("chat:new-message", (payload) => {
      if (payload.roomName !== roomNameRef.current) {
        return;
      }
      setMessages((atual) => [...atual, payload.message]);
      console.log(`[CLIENT][${payload.roomName}] @${payload.message.author}: ${payload.message.text}`);
    });

    socket.on("connect_error", (error) => {
      setScreen("login");
      setStatus(`Falha na conexao: ${error.message}`);
      setNickname("");
      limparSalaAtual();
      setRooms([]);
      console.error("[CLIENT] connect_error", error);
    });

    socket.on("disconnect", (reason) => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      setScreen("login");
      setNickname("");
      setRooms([]);
      limparSalaAtual();
      setStatus(`Conexao encerrada (${reason}).`);
      console.warn(`[CLIENT] disconnect: ${reason}`);
    });
  };

  const criarSala = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const socket = socketRef.current;
    const roomNameCandidate = roomInput.trim();

    if (!socket) {
      setStatus("Conecte primeiro.");
      return;
    }
    if (!roomNameCandidate) {
      setStatus("Digite o nome da sala.");
      return;
    }

    const ack: SocketAck = (response) => {
      if (!response.ok) {
        setStatus(response.error ?? "Falha ao criar sala.");
      }
    };

    socket.emit("room:create", { roomName: roomNameCandidate }, ack);
    setRoomInput("");
  };

  const entrarSala = (roomNameAlvo: string) => {
    const socket = socketRef.current;
    if (!socket) {
      setStatus("Conecte primeiro.");
      return;
    }

    const ack: SocketAck = (response) => {
      if (!response.ok) {
        setStatus(response.error ?? "Falha ao entrar na sala.");
      }
    };

    socket.emit("room:join", { roomName: roomNameAlvo }, ack);
  };

  const sairSala = () => {
    const socket = socketRef.current;
    if (!socket) {
      return;
    }

    const ack: SocketAck = (response) => {
      if (!response.ok) {
        setStatus(response.error ?? "Falha ao sair da sala.");
      }
    };

    socket.emit("room:leave", ack);
  };

  const enviarMensagem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const socket = socketRef.current;
    const texto = messageInput.trim();

    if (!socket) {
      setStatus("Conecte primeiro.");
      return;
    }
    if (!texto) {
      setStatus("Digite uma mensagem.");
      return;
    }

    const ack: SocketAck = (response) => {
      if (!response.ok) {
        setStatus(response.error ?? "Falha ao enviar mensagem.");
      }
    };

    socket.emit("chat:send", { text: texto }, ack);
    setMessageInput("");
  };

  return (
    <div className="app">
      <header className="top-bar">
        <h1>dark_room chat</h1>
        <small>{status}</small>
      </header>

      {screen === "login" ? (
        <section className="panel auth-panel">
          <h2>login</h2>
          <form onSubmit={conectar}>
            <label htmlFor="nickname">nickname</label>
            <input
              id="nickname"
              value={nicknameInput}
              onChange={(event) => setNicknameInput(event.target.value)}
              placeholder="ex.: anon_47"
              autoComplete="off"
            />
            <button type="submit" className="btn-primary">
              entrar
            </button>
          </form>
        </section>
      ) : null}

      {screen === "lobby" ? (
        <main className="lobby">
          <section className="panel">
            <h2>lobby</h2>
            <p>logado como @{nickname}</p>

            <form onSubmit={criarSala} className="inline-form">
              <input
                value={roomInput}
                onChange={(event) => setRoomInput(event.target.value)}
                placeholder="nome da sala"
                autoComplete="off"
              />
              <button type="submit" className="btn-primary">
                criar sala
              </button>
            </form>
          </section>

          <section className="panel">
            <h2>salas abertas</h2>
            <ul className="rooms-list">
              {rooms.length === 0 ? <li>nenhuma sala no momento.</li> : null}
              {rooms.map((room) => (
                <li key={room.name}>
                  <span>
                    #{room.name} ({room.usersCount} online)
                  </span>
                  <button type="button" className="btn-ghost" onClick={() => entrarSala(room.name)}>
                    entrar
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel actions">
            <button type="button" className="btn-ghost" onClick={desconectarTudo}>
              sair da conta
            </button>
          </section>
        </main>
      ) : null}

      {screen === "room" ? (
        <main className="room-layout">
          <section className="panel chat-panel">
            <div className="chat-header">
              <h2>sala #{roomName}</h2>
              <div className="chat-actions">
                <button type="button" className="btn-ghost" onClick={sairSala}>
                  voltar ao lobby
                </button>
                <button type="button" className="btn-ghost" onClick={desconectarTudo}>
                  logout
                </button>
              </div>
            </div>

            <ul className="messages">
              {messages.length === 0 ? <li>sem mensagens ainda.</li> : null}
              {messages.map((message) => (
                <li key={message.id}>
                  <div className="meta">
                    <strong>@{message.author}</strong>
                    <span>{hora(message.createdAt)}</span>
                  </div>
                  <p>{message.text}</p>
                </li>
              ))}
            </ul>

            <form onSubmit={enviarMensagem} className="inline-form">
              <input
                value={messageInput}
                onChange={(event) => setMessageInput(event.target.value)}
                placeholder="digite sua mensagem..."
                autoComplete="off"
              />
              <button type="submit" className="btn-primary">
                enviar
              </button>
            </form>
          </section>

          <aside className="panel users-panel">
            <h2>online ({roomUsers.length})</h2>
            <ul className="users-list">
              {roomUsers.length === 0 ? <li>carregando...</li> : null}
              {roomUsers.map((user) => (
                <li key={user}>@{user}</li>
              ))}
            </ul>
          </aside>
        </main>
      ) : null}
    </div>
  );
}
