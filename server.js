const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ======================================================
// 🔹 CONFIG
// ======================================================

const URL_LOGIN = 'https://www.alinvestverde-c1-monitoreo.com/Admin/Login?ReturnUrl=%2FHome';

// ======================================================
// 🔹 UTILITÁRIOS
// ======================================================

const wait = (page, ms = 500) => page.waitForTimeout(ms);

function formatarDataBR(data) {
    if (!data) return '';
    return new Date(data).toLocaleDateString('pt-BR');
}

// ======================================================
// 🔹 LOGIN
// ======================================================

async function fazerLogin(page, credenciais) {
    console.log('🔐 Fazendo login...');
    await page.goto(URL_LOGIN);
    await page.fill("#UsuarioNombre", credenciais.username);
    await page.fill("#Contrasenia", credenciais.password);
    await page.click("button:has-text('Ingresar')");
    await page.waitForLoadState('networkidle');
}

// ======================================================
// 🔹 PASSOS 3 A 8 (REUTILIZÁVEL PARA QUALQUER QUESTIONÁRIO)
// ======================================================

async function cadastrarEmpresa(page, empresa) {

    console.log('➕ Clicando no botão +');
    await page.click(".dx-icon-add");
    await wait(page, 2000);

    console.log('📝 Preenchendo cadastro');

    // País
    await page.click('#LPais');
    await wait(page);
    await page.click('text=BRASIL');

    // Dados básicos
    await page.fill('input[name="IdentificacionTributaria"]', empresa.cnpj || '');
    await page.fill('input[name="Nombre"]', empresa.nome_empresa || '');
    await page.fill('input[name="CorreoElectronico"]', empresa.email || '');
    await page.fill('input[name="TelefonoEmpresa"]', empresa.telefone || '');
    await page.fill('input[name="Departamento"]', empresa.estado || '');
    await page.fill('input[name="Ciudad"]', empresa.cidade || '');

    // Setor
    if (empresa.setor_negocios_id) {
        const setorIndex = parseInt(empresa.setor_negocios_id, 10) - 1;

        if (setorIndex !== -1) {
            await page.click('#LSector');
            await page.waitForTimeout(500);
            const combo = page.locator('.dx-dropdowneditor-overlay:visible');
            await combo.waitFor();
            const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
            await opcoes.nth(setorIndex).click();
            await page.waitForTimeout(500);
        }
    }

    // Tamanho
    if (empresa.tamanho_empresa_id) {
        const tamanhoIndex = parseInt(empresa.tamanho_empresa_id, 10) - 1;

        if (tamanhoIndex !== -1) {
            await page.click('#LTamanio');
            await page.waitForTimeout(500);
            const combo = page.locator('.dx-dropdowneditor-overlay:visible');
            await combo.waitFor();
            const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
            await opcoes.nth(tamanhoIndex).click();
            await page.waitForTimeout(500);
        }
    }

    // Representante
    const nomes = (empresa.nome_representante || '').split(' ');
    await page.fill('input[name="NombreRepresentante"]', nomes[0] || '');
    await page.fill('input[name="ApellidoRepresentante"]', nomes.slice(1).join(' ') || '');

    // Gênero
    if (empresa.genero_representante_id) {
        const generoIndex = parseInt(empresa.genero_representante_id, 10) - 1;

        if (generoIndex !== -1) {
            await page.click('#LSexo');
            await page.waitForTimeout(500);
            const combo = page.locator('.dx-dropdowneditor-overlay:visible');
            await combo.waitFor();
            const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
            await opcoes.nth(generoIndex).click();
            await page.waitForTimeout(500);
        }
    }

    // Idade
    if (empresa.idade_representante_id) {
        const idadeIndex = parseInt(empresa.idade_representante_id, 10) - 1;
        //const idadeIndex = empresa.idade_representante_id;

        if (idadeIndex !== -1) {
            await page.click('#LEdad');
            await page.waitForTimeout(500);
            const combo = page.locator('.dx-dropdowneditor-overlay:visible');
            await combo.waitFor();
            const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
            await opcoes.nth(idadeIndex).click();
            await page.waitForTimeout(500);
        }
    }


    console.log('💾 Salvando cadastro');
    await page.locator('.dx-button').filter({ hasText: 'Guardar' }).click();
    await wait(page, 6000);

}

async function prepararQuestionario(page, empresa) {
    console.log('📄 Indo para última página');
    await page.locator('.dx-page-indexes .dx-page').last().click();
    await wait(page, 2000);

    console.log('✏️ Editando empresa');
    const linhaEmpresa = page.locator('.dx-data-row', { hasText: empresa.nome_empresa });
    await linhaEmpresa.locator('.dx-link-edit').click();
    await wait(page, 2000);
}

// ======================================================
// 🔹 QUESTIONÁRIO 11OE
// ======================================================

async function preencherQuestionario11OE(page, empresa) {

    console.log('📋 Preenchendo questionário interno');

    const descricao = [
        ...(empresa.boas_praticas_eficiencia_energetica || []),
        ...(empresa.boas_praticas_reducao_agua || []),
        ...(empresa.boas_praticas_gestao_residuos || []),
        ...(empresa.boas_praticas_uso_materiais || []),
        ...(empresa.boas_praticas_processos_cultura || [])
    ].join(';\n');

    await page.fill('textarea[id*="Descripcion"]', descricao);

    const percentuais = [
        empresa.economia_recurso_monetario,
        empresa.economia_agua_potavel,
        empresa.economia_energia_eletrica,
        empresa.economia_materia_prima,
        empresa.economia_materiais_insumos,
        empresa.reducao_descargas_poluentes,
        empresa.reducao_concentracao_poluentes,
        empresa.reutilizacao_materiais,
        empresa.reutilizacao_residuos,
        empresa.reciclagem_materia_prima,
        empresa.reciclagem_materiais_residuais,
        empresa.melhoria_processos_comerciais
    ];

    for (let i = 0; i < percentuais.length; i++) {
        if (percentuais[i]) {
            await page.fill(`input[id*="Porcentaje${i + 1}"]`, String(percentuais[i]));
        }
    }

    // Data
    if (empresa.data_adocao_praticas) {
        await page.fill('input[id*="ActividadFecha"]', formatarDataBR(empresa.data_adocao_praticas));
    }

    // Assinatura
    await page.fill('input[id*="FirmaNombre"]', empresa.assinatura_nome || '');
    await page.fill('input[id*="FirmaCargo"]', empresa.cargo_representante || '');
    await page.fill('input[id*="FirmaFecha"]', formatarDataBR(empresa.assinatura_data));

    console.log('💾 Salvando questionário');
    await page.locator('.dx-button').filter({ hasText: 'Salvar' }).click();
    await wait(page, 2000);
}

// ======================================================
// 🔹 ENDPOINT PRINCIPAL
// ======================================================

app.post('/executar', async (req, res) => {

    let browser;

    try {

        const { empresa, credenciais, isProd, questionarios } = req.body;

        if (!empresa || !credenciais) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        browser = await chromium.launch({
            headless: isProd,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext();
        const page = await context.newPage();

        await fazerLogin(page, credenciais);

        for (const questionario of questionarios) {

            console.log(`Executando questionário: ${questionario.nome} na url ${questionario.url}`);


            // Abrir questionário correto
            const urlQuestionario = questionario.url;
            if (!urlQuestionario) {
                throw new Error("Questionário inválido");
            }

            await page.goto(urlQuestionario);
            await page.waitForLoadState('networkidle');

            // PASSOS PADRÃO
            await cadastrarEmpresa(page, empresa);

            // QUESTIONÁRIO ESPECÍFICO
            if (questionario.nome === "11OE") {
                await prepararQuestionario(page, empresa);
                await preencherQuestionario11OE(page, empresa);
            }
        }

        console.log('Automação concluída com sucesso!');
        res.json({
            success: true,
            message: 'Automação concluída com sucesso',
            empresa: empresa.nome_empresa
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: error.message
        });
    } finally {
        if (browser) await browser.close();
    }
});

// ======================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Executor rodando na porta ${PORT}`);
});