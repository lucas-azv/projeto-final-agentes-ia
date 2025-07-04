import dotenv from "dotenv";
dotenv.config();

import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { GoogleGenerativeAI } from "@google/generative-ai";
import express from "express";
import fs from "fs";
import Fuse from "fuse.js";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Leitura dos arquivos de instruções e base
const instrucoesData = JSON.parse(
  fs.readFileSync(join(__dirname, "config/instrucoes.json"), "utf-8")
);

// knowledge.json é opcional, mas recomendado para melhorar o RAG
let knowledgeBase = [];
let fuse;
const knowledgePath = join(__dirname, "config", "knowledge.json");
if (fs.existsSync(knowledgePath)) {
  knowledgeBase = JSON.parse(fs.readFileSync(knowledgePath, "utf-8"));
  fuse = new Fuse(knowledgeBase, {
    keys: ["title", "text"],
    includeScore: true,
    threshold: 0.4,
    distance: 100,
  });
}

let appConfig = {};
let generativeModel;
let documentContentBase64 = "";
let instrucoes = "";

// Função para carregar configuração e preparar tudo
async function loadConfigAndInitialize() {
  try {
    const configPath = join(__dirname, "config", "data.json");
    appConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log("Configuração carregada com sucesso do data.json.");

    instrucoes = instrucoesData.instrucoes.replaceAll(
      "{{documentName}}",
      appConfig.document.displayName
    );

    const genAI = new GoogleGenerativeAI(process.env.API_KEY);
    generativeModel = genAI.getGenerativeModel({ model: appConfig.modelName });
    console.log(`Modelo Gemini '${appConfig.modelName}' inicializado.`);

    const documentPath = join(__dirname, appConfig.document.path);
    const documentBuffer = fs.readFileSync(documentPath);
    documentContentBase64 = documentBuffer.toString("base64");
    console.log(
      `Documento '${appConfig.document.displayName}' carregado e codificado em Base64.`
    );
  } catch (error) {
    console.error("Erro ao carregar configuração ou documento:", error);
    process.exit(1);
  }
}

// Middleware e rotas
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Função de busca de contexto (RAG simples)
function buscarContexto(userInput) {
  if (!fuse) return "";
  const resultados = fuse.search(userInput);
  const melhores = resultados.slice(0, 3); // até 3 trechos
  return melhores.map((res) => res.item.text).join("\n\n");
}

// Endpoint de chat
app.post("/chat", async (req, res) => {
  const { userInput } = req.body;

  if (!generativeModel) {
    return res.status(503).json({
      error: "Modelo não inicializado. Tente novamente em breve.",
    });
  }

  if (!documentContentBase64) {
    return res.status(500).json({
      error: "Documento base não carregado. Reinicie o servidor.",
    });
  }

  try {
    const contextoRelevante = buscarContexto(userInput);

    const chatContents = [
      {
        role: "user",
        parts: [
          { text: instrucoes },
          contextoRelevante && { text: `Contexto adicional:\n${contextoRelevante}` },
          {
            inlineData: {
              mimeType: appConfig.document.mimeType,
              data: documentContentBase64,
            },
          },
          { text: userInput },
        ].filter(Boolean),
      },
    ];

    const result = await generativeModel.generateContent({
      contents: chatContents,
      generationConfig: appConfig.generationConfig || {},
      safetySettings: appConfig.safetySettings || [],
    });

    const responseText = result.response.text();
    res.json({ response: responseText });
  } catch (error) {
    console.error("Erro ao chamar o modelo:", error);
    res.status(500).json({
      error: "Erro ao gerar resposta com o modelo de IA.",
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

// Inicialização
app.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log("Inicializando chatbot...");
  await loadConfigAndInitialize();
  console.log("Chatbot pronto!");
});
