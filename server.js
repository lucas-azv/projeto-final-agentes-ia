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
let generativeModel;
let documentContentBase64 = '';

async function loadConfigAndInitialize() {
    try {
        const configPath = join(__dirname, 'config', 'data.json');
        appConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('Configuração carregada com sucesso do data.json.');

        const genAI = new GoogleGenerativeAI(process.env.API_KEY);
        generativeModel = genAI.getGenerativeModel({ model: appConfig.modelName });
        console.log(`Modelo Gemini '${appConfig.modelName}' inicializado.`);

        const documentPath = join(__dirname, appConfig.document.path);
        const documentBuffer = fs.readFileSync(documentPath);
        documentContentBase64 = documentBuffer.toString("base64");
        console.log(`Documento '${appConfig.document.displayName}' carregado e codificado em Base64 com sucesso.`);

    } catch (error) {
        console.error('Erro fatal ao carregar configuração ou inicializar:', error);
        process.exit(1);
    }
}

app.listen(PORT, async () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log('Iniciando o chatbot...');

    await loadConfigAndInitialize();
    console.log('Chatbot está pronto para uso!');
});

app.post('/chat', async (req, res) => {
    const { userInput } = req.body;

    if (!generativeModel) {
        return res.status(503).json({ error: 'Modelo Gemini não inicializado. Tente novamente em breve.' });
    }

    if (!documentContentBase64) {
        return res.status(500).json({ error: 'O conteúdo do documento não foi carregado. Reinicie o servidor.' });
    }

    try {
        const chatContents = [
            {
                role: 'user',
                parts: [
                    {
                        text: `**INSTRUÇÕES DO SISTEMA:**\n\nVocê é \"WiFi\", um assistente virtual especializado em auxiliar estudantes do IFTM sobre as **Atividades Complementares (ACs)** necessárias para a conclusão de qualquer curso superior.\n\n**SEU CONTEXTO E DEVER PRINCIPAL:**\nSua responsabilidade é explicar e tirar dúvidas **EXCLUSIVAMENTE** com base nas informações contidas no documento \"${appConfig.document.displayName}\" fornecido. Você **NUNCA** deve buscar informações externas, como na internet, ou inventar dados. Sua fonte de verdade é este documento.\n\n**ESTILO DE COMUNICAÇÃO:**\n* Responda de forma **clara, objetiva e amigável**.\n* Utilize uma **linguagem acessível**, evitando jargões técnicos sempre que possível.\n* **Sempre que aplicável**, forneça **exemplos práticos** relacionados ao contexto das ACs no IFTM.\n* **Direcione o usuário para a seção relevante do documento** quando a resposta for baseada em uma parte específica ou se o usuário precisar de mais detalhes (ex: \"Para mais detalhes sobre as modalidades, consulte a Seção X do documento.\").\n\n**DIRETRIZES DE RESPOSTA:**\n* Se a informação solicitada **NÃO estiver presente** no documento, informe educadamente ao usuário que a informação não foi encontrada no material disponível e que ele deve consultar as fontes oficiais do IFTM, caso a dúvida persista. **Não tente inferir ou adivinhar.**\n* Mantenha o foco nas **Atividades Complementares** e no contexto do IFTM. Evite divagar ou responder a perguntas fora deste escopo.\n\n**EXEMPLO DE INTERAÇÃO (APENAS PARA REFERÊNCIA):**\nUsuário: \"Quais tipos de atividades podem ser validadas como AC?\"\nWiFi: \"De acordo com o ${appConfig.document.displayName}, as Atividades Complementares podem incluir atividades de ensino, pesquisa, extensão, artístico-culturais, esportivas, sociais e ambientais. Por exemplo, participação em projetos de iniciação científica, organização de eventos culturais ou trabalho voluntário. Para uma lista completa, consulte o Capítulo III do regulamento.\"\n`
                    },
                    {
                        inlineData: {
                            mimeType: appConfig.document.mimeType,
                            data: documentContentBase64
                        }
                    },
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
        console.error('Erro ao chamar a API Gemini:', error);
        res.status(500).json({ error: 'Erro ao se comunicar com o modelo de IA. Verifique os logs do servidor.' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'index.html'));
});