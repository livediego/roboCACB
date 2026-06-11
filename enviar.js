const { chromium } = require('playwright');

// ======================================================
// 🔹 CONFIG
// ======================================================
const URL_LOGIN = 'https://www.alinvestverde-c1-monitoreo.com/Admin/Login?ReturnUrl=%2FHome';
const URL = 'https://www.alinvestverde-c1-monitoreo.com/Ficha11OE?IdProyectoIndicadorML=291';
const USERNAME = 'Gabriele.Oliveira CACB';
const PASSWORD = '1234567';

const wait = (page, ms = 500) => page.waitForTimeout(ms);

// ======================================================
// 🔹 LOGIN
// ======================================================
async function fazerLogin(page, credenciais) {
    console.log('🔐 Fazendo login...');

    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.fill('#UsuarioNombre', credenciais.username);
    await page.fill('#Contrasenia', credenciais.password);

    await page.click("button:has-text('Ingresar')");

    await page.waitForFunction(() => {
        return !window.location.href.includes('/Admin/Login');
    }, { timeout: 60000 });

    await page.waitForLoadState('domcontentloaded').catch(() => { });

    console.log('✅ Login concluído');
}

// ======================================================
// 🔹 CÓDIGO PRINCIPAL
// ======================================================
(async () => {

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {

        let credenciais = { username: USERNAME, password: PASSWORD };
        await fazerLogin(page, credenciais);
        console.log(`\n🔍 Acessando página de monitoramento...`);

        await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('networkidle').catch(() => { });
        await wait(page, 2000);

        let pageNumber = 1;
        let hasMorePages = true;

        while (hasMorePages) {
            console.log(`\n--- Página ${pageNumber} ---`);
            await page.waitForSelector('.dx-datagrid-table', { state: 'visible' });

            // Capturar linhas
            const rows = await page.$$('.dx-datagrid-rowsview .dx-data-row');

            for (let i = 0; i < rows.length; i++) {
                // Re-captura a linha para evitar erros de elemento desatualizado
                const row = (await page.$$('.dx-datagrid-rowsview .dx-data-row'))[i];
                const beneficiary = await (await row.$('td:nth-child(2)')).innerText();

                // CRITÉRIO 1: Verificar se a data de envio está vazia
                const dateCell = await row.$('td:nth-child(4)');
                const dateText = (await dateCell.innerText()).trim();

                // CRITÉRIO 2: Verificar se o ícone de "Solicitar Revisão" está visível
                // Se o ícone NÃO estiver lá, significa que já foi enviado ou não está pronto
                const reviewBtn = await row.$('a[title="Solicitar revisão"], a[hint="Solicitar revisão"]');

                if (dateText === '' && reviewBtn) {
                    console.log(`Empresa Pendente: ${beneficiary}`);

                    // Clicar em Arquivo
                    const fileBtn = await row.$('a[title="Arquivo"], a[hint="Arquivo"]');
                    if (fileBtn) {
                        await fileBtn.click();
                        await page.waitForSelector('.dx-popup-content', { state: 'visible' });
                        await page.waitForTimeout(800);

                        // Contar PDFs no modal
                        const files = await page.$$('.dx-popup-content .dx-list-item');
                        let pdfs = [];
                        for (const f of files) {
                            const name = await f.innerText();
                            if (name.toLowerCase().endsWith('.pdf')) pdfs.push(name);
                        }

                        console.log(`- PDFs encontrados: ${pdfs.length}`);

                        // Fechar modal
                        const close = await page.$('.dx-closebutton');
                        if (close) await close.click();
                        await page.waitForSelector('.dx-popup-content', { state: 'hidden' });

                        // Ação: Somente se houver exatamente 1 PDF
                        if (pdfs.length === 1) {
                            console.log(`>>> ENVIANDO REVISÃO para ${beneficiary}...`);
                            await reviewBtn.click();
                            // Se houver confirmação, descomente a linha abaixo:
                            // await page.click('.dx-button:has-text("Sim")'); 
                            await page.waitForTimeout(1000);
                        } else {
                            console.log(`- Pulado: ${pdfs.length === 0 ? 'Sem PDF' : 'Mais de um PDF'}`);
                        }
                    }
                } else {
                    // console.log(`Empresa já enviada ou sem ação disponível: ${beneficiary}`);
                }
            }

            // Navegação para próxima página
            const next = await page.$('.dx-page:has-text("' + (pageNumber + 1) + '")');
            if (next) {
                await next.click();
                pageNumber++;
                await page.waitForTimeout(2000);
            } else {
                hasMorePages = false;
            }
        }

        console.log(`\nAutomação finalizada com sucesso.`);

    } catch (err) {
        console.error('Falha na automação:', err);
    } finally {
        await browser.close();
    }
})();