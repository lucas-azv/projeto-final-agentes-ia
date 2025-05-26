const chatHistory = document.getElementById('chat-history');
const userInput = document.getElementById('user-input');
const form = document.getElementById('chat-form');
const loader = document.getElementById('loader');

async function sendMessage() {
  const userMessage = userInput.value.trim();
  if (!userMessage) return;

  // Mostrar a mensagem do usuário imediatamente
  chatHistory.innerHTML += `<div class="user-message">${userMessage}</div>`;
  chatHistory.scrollTop = chatHistory.scrollHeight;

  userInput.value = ''; // Limpar o input

  try {
    loader.style.display = 'block'; // Mostrar loader

    const response = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userInput: userMessage })
    });

    const data = await response.json();
    const botMessage = data.response || "Erro ao gerar resposta.";
    
    chatHistory.innerHTML += `<div class="bot-message">${botMessage}</div>`;
    chatHistory.scrollTop = chatHistory.scrollHeight;
  } catch (error) {
    console.error('Erro:', error);
    chatHistory.innerHTML += `<div class="bot-message">❌ Ocorreu um erro. Tente novamente.</div>`;
  } finally {
    loader.style.display = 'none'; // Esconder loader
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage();
});
