const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode-terminal');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
 
const client = new Client({
    authStrategy: new LocalAuth(),
});

let cancelSignal = false;

client.on('qr', (qr) => {
    console.log('QR Code recebido. Escaneie no WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp conectado!');
});

client.on('auth_failure', (msg) => {
    console.error('Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
    console.log('WhatsApp desconectado:', reason);
});

client.initialize();

app.post('/api/send-messages', async (req, res) => {
    const { message, numbers, interval = 5000 } = req.body; 

    if (!message || !numbers || numbers.length === 0) {
        return res.status(400).json({ error: 'Mensagem e números são obrigatórios!' });
    }
    cancelSignal = false;

    try {
        for (const number of numbers) {
            const formattedNumber = `${number.replace(/\D/g, '')}@c.us`;
             
            if (cancelSignal) {
                console.log('Envio de mensagens cancelado');
                return res.status(200).json({ status: 'Envio cancelado pelo usuário.' });
            }
            
            const isRegistered = await client.isRegisteredUser(formattedNumber);
            if (!isRegistered) {
                console.log(`Número não registrado no WhatsApp: ${formattedNumber}`);
                continue; 
            }
            try {
                await client.sendMessage(formattedNumber, message);
            } catch (error) {
                console.error(`Erro ao enviar mensagem para ${formattedNumber}:`, error);
            }
            await new Promise(resolve => setTimeout(resolve, interval));
        }

        res.status(200).json({ status: 'Mensagens processadas!' });
    } catch (error) {
        console.error('Erro ao enviar mensagens:', error);
        res.status(500).json({ error: 'Erro ao enviar mensagens' });
    }
    
});
app.post('/api/cancel', (req, res) => {
    cancelSignal = true; 
    res.status(200).json({ status: 'Cancelamento solicitado com sucesso.' });
});


const PORT = 4000;
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
