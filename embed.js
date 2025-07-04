// embed.js
import dotenv from "dotenv";
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pinecone } from "@pinecone-database/pinecone";
import fs from "fs";
import path from "path";

const __dirname = path.resolve();

const knowledge = JSON.parse(
  fs.readFileSync(path.join(__dirname, "config", "knowledge.json"), "utf-8")
);

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pinecone.index("regulamento-ac"); // nome do índice

async function gerarEmbedding(texto) {
  const result = await embeddingModel.embedContent({
    content: {
      parts: [{ text: texto }],
    },
  });

  return result.embedding.values;
}

async function indexarBase() {
  const vetorPayload = await Promise.all(
    knowledge.map(async (item, i) => {
      const embedding = await gerarEmbedding(item.text);
      return {
        id: `item-${i}`,
        values: embedding,
        metadata: {
          title: item.title,
          text: item.text,
        },
      };
    })
  );

  await index.upsert(vetorPayload);
  console.log("Base indexada no Pinecone com sucesso!");
}

indexarBase();
