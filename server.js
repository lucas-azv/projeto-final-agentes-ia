import dotenv from 'dotenv';
dotenv.config();

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { GoogleGenerativeAI } from '@google/generative-ai';
import express from 'express';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

let appConfig = {};
let bnccSummary = '';
let generativeModel;

async function loadConfigAndInitialize() {
    try {
        const configPath = join(__dirname, 'config', 'data.json');
        appConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('Configuração carregada com sucesso do data.json.');

        const genAI = new GoogleGenerativeAI(process.env.API_KEY);
        generativeModel = genAI.getGenerativeModel({ model: appConfig.modelName });

    } catch (error) {
        console.error('Erro ao carregar configuração ou inicializar API Gemini:', error);
        process.exit(1);
    }
}

async function getBnccSummary(filePath) {
    console.log('Iniciando o processamento e resumo do documento BNCC...');
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        return `A Base Nacional Comum Curricular (BNCC) é um documento normativo que define as aprendizagens essenciais que todos os alunos da Educação Básica no Brasil devem desenvolver. Ela busca garantir o direito à aprendizagem, promovendo uma educação equitativa e de qualidade.
A BNCC é estruturada em 10 competências gerais e organizada por etapas da Educação Básica: Educação Infantil (focada no desenvolvimento integral através de interações e brincadeiras), Ensino Fundamental (dividido em Anos Iniciais e Finais, com áreas do conhecimento específicas) e Ensino Médio (organizado em áreas do conhecimento e itinerários formativos).`;
    } catch (error) {
        console.error(`Erro ao ler ou processar o arquivo BNCC em ${filePath}:`, error);
        return 'Não foi possível carregar o resumo da BNCC devido a um erro.';
    }
}


app.listen(PORT, async () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log('Chat está pronto para uso!');

    await loadConfigAndInitialize();

    try {
        const bnccDocPath = join(__dirname, appConfig.document.path);
        bnccSummary = await getBnccSummary(bnccDocPath);
        console.log('Resumo do BNCC gerado com sucesso!');
    } catch (error) {
        console.error('Erro ao processar BNCC durante a inicialização:', error);
        bnccSummary = 'Erro ao carregar o resumo da BNCC.';
    }
});

app.post('/chat', async (req, res) => {
    const { userInput } = req.body;

    if (!generativeModel) {
        return res.status(503).json({ error: 'Modelo Gemini não inicializado. Tente novamente em breve.' });
    }

    try {
        const chatContents = [
            {
                role: 'user',
                parts: [{ text: `Você é Pixie, um assistente de aula virtual especializado em criar roteiros de aula.
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

Se tiver alguma estrutura ou conteúdo específico que deseja abordar, por favor, me avise também!` }]
            },
            {
                role: 'user',
                parts: [{ text: userInput }]
            }
        ];

        const result = await generativeModel.generateContent({
            contents: chatContents,
            
            generationConfig: appConfig.generationConfig,
            safetySettings: appConfig.safetySettings,
        });

        const responseText = result.response.text();
        res.json({ response: responseText });

    } catch (error) {
        console.error('Erro ao chamar a API Gemini:', error);
        res.status(500).json({ error: 'Erro ao se comunicar com o modelo de IA.' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'index.html'));
});