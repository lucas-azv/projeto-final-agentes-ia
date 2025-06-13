import dotenv from "dotenv";
dotenv.config();

import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { GoogleGenerativeAI } from "@google/generative-ai";
import express from "express";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Lê o arquivo de instruções uma vez
const instrucoesData = JSON.parse(
  fs.readFileSync(join(__dirname, "config/instrucoes.json"), "utf-8")
);

let appConfig = {};
let generativeModel;
let documentContentBase64 = "";
let instrucoes = ""; // declarada aqui para atribuir depois

// Função para carregar a configuração e inicializar variáveis e modelo
async function loadConfigAndInitialize() {
  try {
    // Carrega configuração principal
    const configPath = join(__dirname, "config", "data.json");
    appConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log("Configuração carregada com sucesso do data.json.");

    // Agora que appConfig está carregado, monta instrucoes substituindo placeholders
    instrucoes = instrucoesData.instrucoes.replaceAll(
      "{{documentName}}",
      appConfig.document.displayName
    );

    // Inicializa modelo Gemini com a chave da API
    const genAI = new GoogleGenerativeAI(process.env.API_KEY);
    generativeModel = genAI.getGenerativeModel({ model: appConfig.modelName });
    console.log(`Modelo Gemini '${appConfig.modelName}' inicializado.`);

    // Lê o documento e converte para Base64
    const documentPath = join(__dirname, appConfig.document.path);
    const documentBuffer = fs.readFileSync(documentPath);
    documentContentBase64 = documentBuffer.toString("base64");
    console.log(
      `Documento '${appConfig.document.displayName}' carregado e codificado em Base64 com sucesso.`
    );
  } catch (error) {
    console.error("Erro fatal ao carregar configuração ou inicializar:", error);
    process.exit(1);
  }
}

// Middleware e rotas
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

app.post("/chat", async (req, res) => {
  const { userInput } = req.body;

  if (!generativeModel) {
    return res.status(503).json({
      error: "Modelo Gemini não inicializado. Tente novamente em breve.",
    });
  }

  if (!documentContentBase64) {
    return res.status(500).json({
      error: "O conteúdo do documento não foi carregado. Reinicie o servidor.",
    });
  }

  try {
    const chatContents = [
      {
        role: "user",
        parts: [
          { text: instrucoes },
          {
            inlineData: {
              mimeType: appConfig.document.mimeType,
              data: documentContentBase64,
            },
          },
          { text: userInput },
        ],
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
    console.error("Erro ao chamar a API Gemini:", error);
    res.status(500).json({
      error:
        "Erro ao se comunicar com o modelo de IA. Verifique os logs do servidor.",
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

// Inicia o servidor e carrega configuração/modelo
app.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log("Iniciando o chatbot...");

  await loadConfigAndInitialize();

  console.log("Chatbot está pronto para uso!");
});
