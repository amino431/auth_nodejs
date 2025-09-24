import express from 'express';
import Stripe from 'stripe';
import compression from 'compression';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// تهيئة التطبيق
const app = express();
const PORT = process.env.PORT || 3000;

// تكوين Stripe
const stripe = new Stripe("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", {
    apiVersion: '2020-08-27',
    maxNetworkRetries: 3,
    timeout: 30000 // زيادة المهلة لتحمل الأحمال العالية
});

const publishableKey = "pk_live_51M5ULRBiuZTCb1GlFo71wx2nM8P3mSlPEIndg5K2sD7U0vjkgkmpg0mda4ud0LH7VuMQbaKhSUhA87iPWF6Lp4pm00eelbCOXa";

// Middleware للأداء فقط (بدون قيود)
app.use(compression({ level: 9 })); // ضغط عالي
app.use(express.json({ limit: '50mb' })); // زيادة الحد لطلبات كبيرة
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// تعيين Pug كمحرك قوالب
app.set('view engine', 'pug');
app.set('views', join(__dirname, 'views'));

// إنشاء مجلد views إذا لم يكن موجوداً
import fs from 'fs';
import path from 'path';

const viewsDir = path.join(__dirname, 'views');
if (!fs.existsSync(viewsDir)) {
    fs.mkdirSync(viewsDir, { recursive: true });
}

// إنشاء ملف index.pug
const pugTemplate = `
doctype html
html
    head
        meta(charset="UTF-8")
        title Add Payment Card
        script(src="https://js.stripe.com/v3/")
        style.
            body {
                font-family: Arial, sans-serif;
                max-width: 500px;
                margin: 20px auto;
                padding: 20px;
                background-color: #f5f5f5;
            }
            .container {
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 {
                color: #333;
                text-align: center;
            }
            .form-group {
                margin-bottom: 20px;
            }
            label {
                display: block;
                margin-bottom: 5px;
                font-weight: bold;
            }
            input, .card-element {
                width: 100%;
                padding: 10px;
                border: 1px solid #ddd;
                border-radius: 4px;
                font-size: 16px;
            }
            .card-element {
                padding: 15px;
                margin: 10px 0;
            }
            button {
                width: 100%;
                padding: 12px;
                background-color: #6772e5;
                color: white;
                border: none;
                border-radius: 4px;
                font-size: 16px;
                cursor: pointer;
            }
            button:hover {
                background-color: #5469d4;
            }
            button:disabled {
                background-color: #cccccc;
            }
            .message {
                margin-top: 20px;
                padding: 15px;
                border-radius: 4px;
                display: none;
            }
            .success {
                background-color: #d4edda;
                color: #155724;
            }
            .error {
                background-color: #f8d7da;
                color: #721c24;
            }
    body
        .container
            h1 Add New Payment Card
            form#payment-form
                label Card Details
                #card-element.card-element
                button#submit-button(type="submit") Add Card
                #success-message.message.success
                #error-message.message.error

        script.
            var stripe = Stripe('#{publishableKey}');
            var elements = stripe.elements();
            var cardElement = elements.create('card');
            cardElement.mount('#card-element');

            var form = document.getElementById('payment-form');
            var submitButton = document.getElementById('submit-button');
            
            form.addEventListener('submit', function(event) {
                event.preventDefault();
                submitButton.disabled = true;
                document.getElementById('error-message').style.display = 'none';
                
                stripe.createToken(cardElement).then(function(result) {
                    if (result.error) {
                        showError(result.error.message);
                        submitButton.disabled = false;
                    } else {
                        fetch('/add_card', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                token_id: result.token.id
                            }),
                        })
                        .then(function(response) {
                            return response.json();
                        })
                        .then(function(data) {
                            if (data.error) {
                                let errorMsg = data.error;
                                if (data.decline_code) {
                                    errorMsg += ' (Decline Code: ' + data.decline_code + ')';
                                }
                                if (data.stripe_error_type) {
                                    errorMsg += ' (Error Type: ' + data.stripe_error_type + ')';
                                }
                                showError(errorMsg);
                                submitButton.disabled = false;
                            } else {
                                showSuccess('Card added successfully!');
                                form.reset();
                                cardElement.clear();
                                
                                setTimeout(() => {
                                    submitButton.disabled = false;
                                }, 3000);
                            }
                        })
                        .catch(function(error) {
                            showError('Network error: ' + error.message);
                            submitButton.disabled = false;
                        });
                    }
                });
            });

            function showError(message) {
                var errorElement = document.getElementById('error-message');
                errorElement.textContent = message;
                errorElement.style.display = 'block';
            }

            function showSuccess(message) {
                var successElement = document.getElementById('success-message');
                successElement.textContent = message;
                successElement.style.display = 'block';
            }
`;

// حفظ القالب في ملف
fs.writeFileSync(path.join(viewsDir, 'index.pug'), pugTemplate);

// خادم HTTP محسّن للأداء
import http from 'http';

const server = http.createServer(app);

// تحسين إعدادات الخادم للأداء العالي
server.keepAliveTimeout = 120000; // 2 دقيقة
server.headersTimeout = 120000;
server.maxHeadersCount = 1000;

// وظيفة لإنشاء عميل
async function getOrCreateCustomer() {
    try {
        const customer = await stripe.customers.create({
            description: "Created via card addition form"
        });
        return customer.id;
    } catch (error) {
        throw new Error(`Stripe error: ${error.message}`);
    }
}

// وظيفة لحذف البطاقة بعد تأخير
function deleteCardAfterDelay(customerId, sourceId, delaySeconds) {
    return new Promise((resolve) => {
        setTimeout(async () => {
            try {
                const deleted = await stripe.customers.deleteSource(
                    customerId,
                    sourceId
                );
                console.log(`Card ${sourceId} deleted successfully from customer ${customerId}`);
                resolve({ success: true });
            } catch (error) {
                console.error(`Error deleting card ${sourceId}: ${error.message}`);
                resolve({ success: false, error: error.message });
            }
        }, delaySeconds * 1000);
    });
}

// الراوت الأساسي
app.get('/', (req, res) => {
    res.render('index', { publishableKey });
});

// معالجة إضافة البطاقة مع تحسينات للأداء
app.post('/add_card', async (req, res) => {
    try {
        const { token_id } = req.body;
        
        if (!token_id) {
            return res.status(400).json({
                error: "Token ID is required",
                decline_code: '',
                stripe_error_type: ''
            });
        }

        // إنشاء عميل جديد
        const customerId = await getOrCreateCustomer();
        
        // إضافة البطاقة إلى العميل
        const source = await stripe.customers.createSource(customerId, {
            source: token_id
        });
        
        // جعل البطاقة الافتراضية
        await stripe.customers.update(customerId, {
            default_source: source.id
        });
        
        // حذف البطاقة بعد 5 ثواني (غير متزامن - لا ينتظر)
        deleteCardAfterDelay(customerId, source.id, 5)
            .then(result => {
                if (!result.success) {
                    console.error('Failed to delete card:', result.error);
                }
            })
            .catch(err => {
                console.error('Error in card deletion:', err);
            });
        
        res.json({
            success: true,
            customer_id: customerId,
            source_id: source.id,
            message: 'Card added successfully'
        });
        
    } catch (error) {
        console.error('Error processing card:', error);
        
        if (error.type === 'StripeCardError') {
            res.status(400).json({
                error: `Card error: ${error.message}`,
                decline_code: error.decline_code || '',
                stripe_error_type: error.type || ''
            });
        } else if (error.type && error.type.startsWith('Stripe')) {
            res.status(400).json({
                error: `Stripe error: ${error.message}`,
                decline_code: error.decline_code || '',
                stripe_error_type: error.type || ''
            });
        } else {
            res.status(500).json({
                error: `Unexpected error: ${error.message}`,
                decline_code: '',
                stripe_error_type: ''
            });
        }
    }
});

// راوت للصحة
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        uptime: process.uptime()
    });
});

// معالجة الأخطاء
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        decline_code: '',
        stripe_error_type: ''
    });
});

// بدء الخادم
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
🚀 Server running at: http://localhost:${PORT}
📊 Process PID: ${process.pid}
💻 CPU Cores: ${os.cpus().length}
📈 Memory: ${Math.round(os.totalmem() / (1024 * 1024 * 1024))}GB
🕒 Started at: ${new Date().toISOString()}
    `);
});

// معالجة إغلاق التطبيق بشكل أنيق
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});
