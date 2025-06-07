const chatHistory = document.getElementById("chat-history");
const userInput = document.getElementById("user-input");
const form = document.getElementById("chat-form");
const loader = document.getElementById("loader");

async function sendMessage() {
  const userMessage = userInput.value.trim();
  if (!userMessage) return;

  chatHistory.innerHTML += `<div class="user-message">${userMessage}</div>`;
  chatHistory.scrollTop = chatHistory.scrollHeight;

  userInput.value = "";

  try {
    loader.style.display = "block";

    const response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userInput: userMessage }),
    });

    const data = await response.json();
    const botMessage = data.response || "Erro ao gerar resposta.";

    const html = marked.parse(botMessage);
    chatHistory.innerHTML += `<div class="bot-message">${html}</div>`;
    chatHistory.scrollTop = chatHistory.scrollHeight;
  } catch (error) {
    console.error("Erro:", error);
    chatHistory.innerHTML += `<div class="bot-message">❌ Ocorreu um erro. Tente novamente.</div>`;
  } finally {
    loader.style.display = "none";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage();
});
