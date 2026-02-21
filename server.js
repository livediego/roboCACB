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

    console.log(`📝 Preenchendo cadastro da Empresa ${empresa.nome_empresa}`);

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
            await wait(page);
            const combo = page.locator('.dx-dropdowneditor-overlay:visible');
            await combo.waitFor();
            const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
            await opcoes.nth(setorIndex).click();
            await wait(page);
        }
    }

    // Tamanho
    if (empresa.tamanho_empresa_id) {
        const tamanhoIndex = parseInt(empresa.tamanho_empresa_id, 10) - 1;

        if (tamanhoIndex !== -1) {
            await page.click('#LTamanio');
            await wait(page);
            const combo = page.locator('.dx-dropdowneditor-overlay:visible');
            await combo.waitFor();
            const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
            await opcoes.nth(tamanhoIndex).click();
            await wait(page);
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
            await wait(page);
            const combo = page.locator('.dx-dropdowneditor-overlay:visible');
            await combo.waitFor();
            const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
            await opcoes.nth(generoIndex).click();
            await wait(page);
        }
    }

    // Idade
    if (empresa.idade_representante_id) {
        const idadeIndex = parseInt(empresa.idade_representante_id, 10) - 1;
        //const idadeIndex = empresa.idade_representante_id;

        if (idadeIndex !== -1) {
            await page.click('#LEdad');
            await wait(page);
            const combo = page.locator('.dx-dropdowneditor-overlay:visible');
            await combo.waitFor();
            const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
            await opcoes.nth(idadeIndex).click();
            await wait(page);
        }
    }


    console.log('💾 Salvando cadastro');
    await page.locator('.dx-button').filter({ hasText: 'Guardar' }).click();
    await wait(page, 2000);

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

async function fechoQuestionario(page, empresa) {
    // Assinatura
    await page.fill('input[id*="FirmaNombre"]', empresa.assinatura_nome || '');
    await page.fill('input[id*="FirmaCargo"]', empresa.cargo_representante || '');
    await page.fill('input[id*="FirmaFecha"]', formatarDataBR(empresa.assinatura_data));

    console.log('💾 Salvando questionário');
    await page.locator('.dx-button').filter({ hasText: 'Salvar' }).click();
    await wait(page, 2000);
}

// ======================================================
// 🔹 QUESTIONÁRIOS
// ======================================================

async function preencherQuestionario11OE(page, empresa) {

    console.log('📋 Preenchendo questionário interno 11OE');

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

    await fechoQuestionario(page, empresa);
}

async function preencherQuestionario12OE(page, empresa) {
    console.log('📋 Preenchendo questionário interno 12OE');


    const sexoMap = {
        "Mulher": "Mujer/Women",
        "Homem": "Hombre/Man",
        "Prefere não informar": "Prefiere no indicar/Prefers not to indicate"
    }

    const empregos = empresa.empregos_sustentaveis || { tabela: [] };

    for (const emprego of empregos.tabela) {
        await page.getByRole('button', { name: 'Adicionar uma linha' }).click();
        await page.getByRole('spinbutton').first().fill(String(emprego.ano));
        await page.getByRole('spinbutton').first().press('Tab');
        await page.getByRole('row', { name: 'Editar   Salvar   Cancelar' }).getByLabel('Selecione').click();
        await page.getByRole('listbox').getByText(sexoMap[emprego.sexo]).click();
        await page.getByRole('row', { name: 'Editar   Salvar   Cancelar' }).getByRole('combobox').press('Tab');
        await page.getByRole('spinbutton').nth(1).fill(String(emprego.formal_sustentavel));
        await page.getByRole('spinbutton').nth(1).press('Tab');
        await page.getByRole('spinbutton').nth(2).fill(String(emprego.informal_sustentavel));
        await page.getByRole('spinbutton').nth(2).press('Tab');
        await page.getByRole('spinbutton').nth(3).fill(String(emprego.formal_digital));
        await page.getByRole('spinbutton').nth(3).press('Tab');
        await page.getByRole('spinbutton').nth(4).fill(String(emprego.informal_digital));
        await page.getByRole('link', { name: 'Salvar' }).click();
        await wait(page, 2000);
    }

    // Marcar checkboxes de áreas de empregos verdes
    const areasEmpregos = empresa.areas_empregos_verdes || [];
    for (let i = 0; i < areasEmpregos.length; i++) {
        if (areasEmpregos[i].valor) {
            console.log(`Marcando área de emprego verde nº ${i + 1}, de nome ${areasEmpregos[i].nome} com valor ${areasEmpregos[i].valor}`);
            const areaSelector = `[id$="_Area${i + 1}"]`;
            await page.locator(areaSelector).click();
            await wait(page);
        }
    }

    // Preencher detalhe de áreas de empregos verdes se fornecido
    if (empresa.detalhe_area_empregos) {
        const detalheSelector = `[id$="_Area8detalle"]`;
        await page.locator(detalheSelector).fill(empresa.detalhe_area_empregos);
        await wait(page);
    }

    await fechoQuestionario(page, empresa);
}

async function preencherQuestionario12(page, empresa) {
    console.log('📋 Preenchendo questionário interno 12');
    await fechoQuestionario(page, empresa);
}

async function preencherQuestionario13(page, empresa) {
    console.log('📋 Preenchendo questionário interno 13');
    await page.getByRole('spinbutton', { name: 'Ano de faturamento:' }).fill(String(empresa.ano_faturamento));
    await page.getByRole('spinbutton', { name: 'O volume de negócios é de:' }).fill(String(empresa.volume_negocios));
    await page.locator(`#cbLimite${empresa.aumento_faturamento}`).click();
    await fechoQuestionario(page, empresa);
}

async function preencherQuestionario14(page, empresa) {
    console.log('📋 Preenchendo questionário interno 14');

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

    const percentuaisMap = {
        "Economia de recurso monetário": empresa.economia_recurso_monetario,
        "Economia de água potável": empresa.economia_agua_potavel,
        "Economia de energia elétrica": empresa.economia_energia_eletrica,
        "Economia de matéria prima": empresa.economia_materia_prima,
        "Economia de materiais/insumos": empresa.economia_materiais_insumos,
        "Redução de descargas poluentes": empresa.reducao_descargas_poluentes,
        "Redução de concentração de poluentes": empresa.reducao_concentracao_poluentes,
        "Reutilização de materiais": empresa.reutilizacao_materiais,
        "Reutilização de resíduos": empresa.reutilizacao_residuos,
        "Reciclagem de matéria prima": empresa.reciclagem_materia_prima,
        "Reciclagem de materiais residuais": empresa.reciclagem_materiais_residuais,
        "Melhoria em processos comerciais": empresa.melhoria_processos_comerciais
    };

    for (const [key, fieldId] of Object.entries(percentuaisMap)) {
        const valor = fieldId;
        if (valor) {
            console.log(`Preenchendo ${key} com valor ${valor}`);
            await page.getByRole('button', { name: 'Adicionar uma linha' }).click();
            await page.getByRole('row', { name: 'Editar   Salvar   Cancelar' }).getByRole('textbox').fill(key);
            await page.getByRole('row', { name: 'Editar   Salvar   Cancelar' }).getByRole('textbox').press('Tab');
            await page.getByRole('spinbutton').fill(String(valor));
            await page.getByRole('link', { name: 'Salvar' }).click();
            await wait(page, 2000);
        }
    }

    await fechoQuestionario(page, empresa);
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

            await cadastrarEmpresa(page, empresa);

            await prepararQuestionario(page, empresa);

            switch (questionario.nome) {
                case "11OE":
                    await preencherQuestionario11OE(page, empresa);
                    break;
                case "12OE":
                    await preencherQuestionario12OE(page, empresa);
                    break;
                case "12":
                    await preencherQuestionario12(page, empresa);
                    break;
                case "13":
                    await preencherQuestionario13(page, empresa);
                    break;
                case "14":
                    await preencherQuestionario14(page, empresa);
                    break;
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