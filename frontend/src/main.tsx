// Tecnico: Importa runtime do React.
// Crianca: Liga o motor da tela.
import React from "react";

// Tecnico: API do ReactDOM para render em raiz moderna.
// Crianca: Ferramenta que desenha o app na pagina.
import ReactDOM from "react-dom/client";

// Tecnico: Componente principal da aplicacao.
// Crianca: Tela principal do prototipo MMO.
import App from "./App";

// Tecnico: Estilos globais.
// Crianca: Roupas e cores da interface.
import "./styles.css";

// Tecnico: Cria root na div #root e renderiza o Aplicativo com StrictMode.
// Crianca: Coloca o app dentro da caixa principal da pagina.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
