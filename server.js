import dotenv from 'dotenv';
dotenv.config();

import { Buffer } from 'buffer';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
    console.error("ERRO: A variável de ambiente API_KEY não está definida. Verifique seu arquivo .env.");
    process.exit(1);
}

let appConfig = null;
try {
    const configPath = path.join(__dirname, 'config', 'data.json');
    const configContent = await fs.readFile(configPath, 'utf8');
    appConfig = JSON.parse(configContent);
    console.log('Configuração carregada com sucesso do data.json.');
} catch (error) {
    console.error('ERRO: Não foi possível carregar ou parsear config/data.json:', error);
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: appConfig.modelName });

let bnccSummary = null;

async function fileToGenerativePart(filePath, mimeType) {
    const fileContent = await fs.readFile(filePath);
    return {
        inlineData: {
            data: Buffer.from(fileContent).toString('base64'),
            mimeType
        },
    };
}

async function processAndSummarizeBNCC() {
    console.log('Iniciando o processamento e resumo do documento BNCC...');
    try {
        const docPath = path.join(__dirname, appConfig.document.path);
        const docMimeType = appConfig.document.mimeType;

        const pdfPart = await fileToGenerativePart(docPath, docMimeType);

        const contentsForSummary = [
            {
                role: 'user',
                parts: [
                    { text: 'Por favor, resuma este documento de forma abrangente e em português.' },
                    pdfPart
                ]
            }
        ];

        // console.log('PAYLOAD PARA RESUMO BNCC:'); // Linha removida
        // console.dir(contentsForSummary, { depth: null, colors: true }); // Linha removida

        const result = await model.generateContent({
            contents: contentsForSummary,
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 1024,
            }
        });
        const response = await result.response;
        const summary = response.text();

        console.log('Resumo do BNCC gerado com sucesso!');
        bnccSummary = summary;
        return true;
    } catch (error) {
        console.error('Erro ao processar e resumir o documento BNCC:', error);
        if (error.errorDetails) {
            console.error('Detalhes do erro da API:', JSON.stringify(error.errorDetails, null, 2));
        }
        bnccSummary = "Desculpe, não consegui processar o documento BNCC. Por favor, tente novamente mais tarde.";
        return false;
    }
}

async function startServer() {
    await processAndSummarizeBNCC();

    if (bnccSummary === "Desculpe, não consegui processar o documento BNCC. Por favor, tente novamente mais tarde.") {
        console.warn('Aviso: O resumo da BNCC falhou, o Pixie poderá ter dificuldades em responder sobre o documento.');
    }

    app.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
        console.log('Chat está pronto para uso!');
    });
}

app.post('/chat', async (req, res) => {
    const userMessage = req.body.userInput;
    // console.log('Mensagem do usuário recebida:', userMessage); // Linha removida

    if (!userMessage) {
        return res.status(400).json({ response: 'Por favor, digite uma mensagem.' });
    }

    let botResponse = "Desculpe, não consegui gerar uma resposta no momento. Tente novamente.";

    try {
        if (bnccSummary === null) {
            return res.status(503).json({
                response: "O Pixie ainda está carregando o documento BNCC. Por favor, aguarde alguns instantes e tente novamente."
            });
        }
        
        if (bnccSummary.includes("Desculpe, não consegui processar o documento BNCC")) {
            return res.json({
                response: `Olá! Sou Pixie, seu assistente de aula virtual!
                O documento que eu deveria acessar (BNCC) não pôde ser processado.
                Portanto, não tenho acesso ao conteúdo da BNCC para elaborar o roteiro da aula.
                Posso ajudar com informações gerais, mas para roteiros personalizados, o documento é essencial.
                Por favor, me responda às perguntas para que eu possa criar um roteiro eficaz.`
            });
        }

        let chatContents = [];

        const systemPromptWithBNCCContext =
            `Você é Pixie, um assistente de aula virtual especializado em criar roteiros de aula.
            Seu objetivo é auxiliar professores e estudantes a desenvolverem planos de aula detalhados e contextualizados.
            VOCÊ DEVE SEMPRE USAR O CONTEXTO ABAIXO COMO SUA FONTE PRINCIPAL DE INFORMAÇÃO, especialmente para criar roteiros e responder perguntas sobre o documento.
            O documento de referência que você está utilizando é a "${appConfig.document.displayName}".
            
            RESUMO DO DOCUMENTO "${appConfig.document.displayName}":
            \`\`\`
            ${bnccSummary}
            \`\`\`
            
            Sempre se apresente como Pixie. Agora, para começar a criar roteiros, eu preciso de algumas informações.
            Perguntas para iniciar a criação de um roteiro de aula:
            1. Qual a matéria?
            2. Qual o tema da aula?
            3. Qual o objetivo da aula?
            4. Qual o público-alvo?
            5. Qual a duração da aula?
            6. Qual o tom de voz/estilo?
            
            Se tiver alguma estrutura ou conteúdo específico que deseja abordar, por favor, me avise também!`;

        chatContents.push({
            role: 'user',
            parts: [{ text: systemPromptWithBNCCContext }]
        });

        chatContents.push({
            role: 'user',
            parts: [{ text: userMessage }]
        });

        const result = await model.generateContent({
            contents: chatContents,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 500,
            }
        });
        const response = await result.response;
        botResponse = response.text();

        res.json({ response: botResponse });

    } catch (error) {
        console.error('Erro ao gerar resposta do chatbot:', error);
        if (error.errorDetails) {
            console.error('Detalhes do erro da API:', JSON.stringify(error.errorDetails, null, 2));
        }
        res.status(500).json({ response: '❌ Ocorreu um erro ao processar sua solicitação.' });
    }
});

startServer();