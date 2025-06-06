const chatHistory = document.getElementById("chat-history");
const userInput = document.getElementById("user-input");
const form = document.getElementById("chat-form");
const loader = document.getElementById("loader");

// Mensagem de saudação e propósito do modelo que será exibida no início
const welcomeMessage = "Olá! Eu sou o seu assistente de IA, Pixie, especializado em ajudar professores a criar roteiros de aulas com base nas diretrizes da Base Nacional Comum Curricular (BNCC). Meu propósito é fornecer suporte completo para o planejamento de suas aulas de forma eficiente e alinhada aos objetivos de aprendizagem.";

// Função auxiliar para adicionar mensagens ao chat (simplificada para seu estilo)
function addMessageToChat(message, senderClass) {
    const messageElement = document.createElement('div');
    messageElement.classList.add(senderClass);
    // Use marked.parse se você tiver a biblioteca marked.js incluída no HTML
    // Caso contrário, use messageElement.textContent = message;
    messageElement.innerHTML = marked.parse(message); // Assumindo que marked.js está incluído
    chatHistory.appendChild(messageElement);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

async function sendMessage() {
    const userMessage = userInput.value.trim();
    if (!userMessage) return;

    addMessageToChat(userMessage, "user-message"); // Usa a função auxiliar
    userInput.value = ""; // Limpa o input

    try {
        loader.style.display = "block"; // Mostra o loader

        const response = await fetch("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Você precisará de um sessionId para manter o histórico por usuário no backend
            // Vamos gerar um sessionId simples aqui
            body: JSON.stringify({ userInput: userMessage, sessionId: getSessionId() }),
        });

        const data = await response.json();
        const botMessage = data.response || "Erro ao gerar resposta.";

        addMessageToChat(botMessage, "bot-message"); // Usa a função auxiliar
    } catch (error) {
        console.error("Erro:", error);
        addMessageToChat("❌ Ocorreu um erro. Tente novamente.", "bot-message error"); // Estilo de erro
    } finally {
        loader.style.display = "none"; // Esconde o loader
        userInput.focus(); // Coloca o foco de volta no input
    }
}

// Função para obter ou criar um ID de sessão
function getSessionId() {
    let sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
        sessionId = Date.now().toString(); // ID baseado no timestamp
        localStorage.setItem('sessionId', sessionId);
    }
    return sessionId;
}

// Event listener para o formulário de chat
form.addEventListener("submit", (event) => {
    event.preventDefault(); // Impede o envio padrão do formulário
    sendMessage();
});

// *** Adiciona a mensagem de boas-vindas ao carregar a página ***
document.addEventListener('DOMContentLoaded', () => {
    addMessageToChat(welcomeMessage, "bot-message"); // Exibe a saudação como uma mensagem do bot
    userInput.focus(); // Foca no campo de input para o usuário
});