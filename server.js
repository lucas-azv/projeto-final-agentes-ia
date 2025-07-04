import dotenv from "dotenv";
dotenv.config();

import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pinecone } from "@pinecone-database/pinecone";

import express from "express";
import fs from "fs";

// 📁 Diretório atual
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 🚀 App Express
const app = express();
const PORT = process.env.PORT || 3000;

// 🧠 Carrega instruções e configs
const instrucoesData = JSON.parse(
  fs.readFileSync(join(__dirname, "config", "instrucoes.json"), "utf-8")
);

const appConfig = JSON.parse(
  fs.readFileSync(join(__dirname, "config", "data.json"), "utf-8")
);

// 📌 Substitui placeholder do nome do documento nas instruções
const instrucoes = instrucoesData.instrucoes.replaceAll(
  "{{documentName}}",
  appConfig.document.displayName
);

// 🔑 Inicializa Gemini
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const generativeModel = genAI.getGenerativeModel({ model: appConfig.modelName });
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });

// 🧲 Inicializa Pinecone
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index("regulamento-ac"); // nome do índice

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// 📌 Função de busca semântica
async function buscarContextoSemantico(userInput) {
  const userEmbedding = await embeddingModel.embedContent({
    content: { parts: [{ text: userInput }] }
  });

  const vector = userEmbedding.embedding.values;

  const resultado = await index.query({
    vector,
    topK: 3,
    includeMetadata: true,
  });

  return resultado.matches
    .map((match) => match.metadata.text)
    .join("\n\n");
}

// 🧠 Endpoint principal de chat
app.post("/chat", async (req, res) => {
  const { userInput } = req.body;

  try {
    const contexto = await buscarContextoSemantico(userInput);

    const chatContents = [
      {
        role: "user",
        parts: [
          { text: instrucoes },
          { text: contexto },
          { text: userInput }
        ]
      }
    ];

    const result = await generativeModel.generateContent({
      contents: chatContents,
      generationConfig: appConfig.generationConfig || {},
      safetySettings: appConfig.safetySettings || [],
    });

    const responseText = result.response.text();
    res.json({ response: responseText });
  } catch (error) {
    console.error("Erro ao processar /chat:", error);
    res.status(500).json({ error: "Erro interno. Verifique os logs." });
  }
});

// 🏠 Página inicial
app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

// 🚀 Inicializa servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
