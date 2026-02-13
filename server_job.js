const express = require('express');
const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json({ limit: '10mb' }));

const jobs = {};


// ======================================================
// 🔹 1. CRIAR BROWSER
// ======================================================

async function criarBrowser(isProd) {
    return await chromium.launch({
        headless: isProd,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
}


// ======================================================
// 🔹 2. LOGIN
// ======================================================

async function fazerLogin(page, credenciais) {

    console.log("🔐 Fazendo login...");

    await page.goto('https://www.alinvestverde-c1-monitoreo.com/Admin/Login?ReturnUrl=%2FHome');
    await page.fill("//input[@id='UsuarioNombre']", credenciais.username);
    await page.fill("//input[@id='Contrasenia']", credenciais.password);
    await page.click("//button[normalize-space()='Ingresar']");

    await page.waitForLoadState('networkidle');

    console.log("✅ Login realizado");
}


// ======================================================
// 🔹 3. EXECUTAR UMA EMPRESA (FUNÇÃO REUTILIZÁVEL)
// ======================================================

async function executarEmpresa(page, empresa) {

    const inicio = Date.now();

    try {

        console.log(`🏢 Processando: ${empresa.nome_empresa}`);

        // 1. NAVEGAR PARA O QUESTIONÁRIO 11OE
        console.log('Navegando para o questionário...');
        await page.goto('https://www.alinvestverde-c1-monitoreo.com/Ficha11OE?IdProyectoIndicadorML=291');
        await page.waitForLoadState('networkidle');

        // 2. CLICAR NO BOTÃO "+"
        console.log('Clicando no botão +...');
        await page.click("//i[@class='dx-icon dx-icon-add']");
        await page.waitForTimeout(timeout2);

        // 3. PREENCHER FORMULÁRIO DE CADASTRO DA EMPRESA
        console.log('Preenchendo formulário de cadastro...');

        // País: Brasil
        await page.click('#LPais');
        await page.waitForTimeout(timeout1);
        await page.click('text=BRASIL');
        await page.waitForTimeout(timeout1);

        // Dados cadastrais da empresa
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
                await page.waitForTimeout(timeout1);
                const combo = page.locator('.dx-dropdowneditor-overlay:visible');
                await combo.waitFor();
                const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
                await opcoes.nth(setorIndex).click();
                await page.waitForTimeout(timeout1);
            }
        }

        // Tamanho
        if (empresa.tamanho_empresa_id) {
            const tamanhoIndex = parseInt(empresa.tamanho_empresa_id, 10) - 1;

            if (tamanhoIndex !== -1) {
                await page.click('#LTamanio');
                await page.waitForTimeout(timeout1);
                const combo = page.locator('.dx-dropdowneditor-overlay:visible');
                await combo.waitFor();
                const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
                await opcoes.nth(tamanhoIndex).click();
                await page.waitForTimeout(timeout1);
            }
        }

        // Nome do Representante
        const nomes = (empresa.nome_representante || '').split(' ');
        await page.fill('input[name="NombreRepresentante"]', nomes[0] || '');
        await page.fill('input[name="ApellidoRepresentante"]', nomes.slice(1).join(' ') || '');

        // Gênero
        if (empresa.genero_representante_id) {
            const generoIndex = parseInt(empresa.genero_representante_id, 10) - 1;

            if (generoIndex !== -1) {
                await page.click('#LSexo');
                await page.waitForTimeout(timeout1);
                const combo = page.locator('.dx-dropdowneditor-overlay:visible');
                await combo.waitFor();
                const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
                await opcoes.nth(generoIndex).click();
                await page.waitForTimeout(timeout1);
            }
        }

        // Idade
        if (empresa.idade_representante_id) {
            const idadeIndex = parseInt(empresa.idade_representante_id, 10) - 1;
            //const idadeIndex = empresa.idade_representante_id;

            if (idadeIndex !== -1) {
                await page.click('#LEdad');
                await page.waitForTimeout(timeout1);
                const combo = page.locator('.dx-dropdowneditor-overlay:visible');
                await combo.waitFor();
                const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
                await opcoes.nth(idadeIndex).click();
                await page.waitForTimeout(timeout1);
            }
        }

        // 4. SALVAR
        console.log('Salvando cadastro da empresa...');
        await page.locator('.dx-button').filter({ hasText: 'Guardar' }).click();
        await page.waitForTimeout(timeout2);

        // 5. NAVEGAR PARA ÚLTIMA PÁGINA
        console.log('Navegando para a última página...');
        const lastPageButton = page.locator('.dx-page-indexes .dx-page').last();
        await lastPageButton.click();
        await page.waitForTimeout(timeout2);

        // 6. EDITAR
        console.log('Clicando em Editar...');
        //await page.getByLabel('Editar').last().click();
        const linhaEmpresa = page.locator('.dx-data-row', {
            hasText: empresa.nome_empresa
        });

        await linhaEmpresa
            .locator('a.dx-link.dx-link-edit.dx-icon-edit')
            .click();

        await page.waitForTimeout(timeout2);

        // 7. PREENCHER QUESTIONÁRIO INTERNO
        console.log('Preenchendo questionário interno...');

        // Descrição das práticas
        const descricaoPraticas = [
            ...(empresa.boas_praticas_eficiencia_energetica || []),
            ...(empresa.boas_praticas_reducao_agua || []),
            ...(empresa.boas_praticas_gestao_residuos || []),
            ...(empresa.boas_praticas_uso_materiais || []),
            ...(empresa.boas_praticas_processos_cultura || [])
        ].join(';\n');

        await page.fill('textarea[id*="Descripcion"]', descricaoPraticas);

        // Percentuais de economia
        if (empresa.economia_recurso_monetario) {
            await page.fill('input[id*="Porcentaje1"]', String(empresa.economia_recurso_monetario));
        }
        if (empresa.economia_agua_potavel) {
            await page.fill('input[id*="Porcentaje2"]', String(empresa.economia_agua_potavel));
        }
        if (empresa.economia_energia_eletrica) {
            await page.fill('input[id*="Porcentaje3"]', String(empresa.economia_energia_eletrica));
        }
        if (empresa.economia_materia_prima) {
            await page.fill('input[id*="Porcentaje4"]', String(empresa.economia_materia_prima));
        }
        if (empresa.economia_materiais_insumos) {
            await page.fill('input[id*="Porcentaje5"]', String(empresa.economia_materiais_insumos));
        }
        if (empresa.reducao_descargas_poluentes) {
            await page.fill('input[id*="Porcentaje6"]', String(empresa.reducao_descargas_poluentes));
        }
        if (empresa.reducao_concentracao_poluentes) {
            await page.fill('input[id*="Porcentaje7"]', String(empresa.reducao_concentracao_poluentes));
        }
        if (empresa.reutilizacao_materiais) {
            await page.fill('input[id*="Porcentaje8"]', String(empresa.reutilizacao_materiais));
        }
        if (empresa.reutilizacao_residuos) {
            await page.fill('input[id*="Porcentaje9"]', String(empresa.reutilizacao_residuos));
        }
        if (empresa.reciclagem_materia_prima) {
            await page.fill('input[id*="Porcentaje10"]', String(empresa.reciclagem_materia_prima));
        }
        if (empresa.reciclagem_materiais_residuais) {
            await page.fill('input[id*="Porcentaje11"]', String(empresa.reciclagem_materiais_residuais));
        }
        if (empresa.melhoria_processos_comerciais) {
            await page.fill('input[id*="Porcentaje12"]', String(empresa.melhoria_processos_comerciais));
        }

        // Atividades geradas
        if (empresa.atividades_geradas && empresa.atividades_geradas.length > 0) {
            const atividadesMap = {
                "Redesenho de produtos": "Actividad1",
                "Redesenho de etiquetas": "Actividad2",
                "maquinário mais eficiente": "Actividad3",
                "fontes de energia mais eficientes": "Actividad4",
                "infraestrutura mais eficiente": "Actividad5",
                "treinamento": "Actividad6",
                "comunicação com os clientes": "Actividad7",
                "Cumprimento de normas ecológicas": "Actividad8",
                "Outro": "Actividad9"
            };

            for (const atividade of empresa.atividades_geradas) {
                for (const [key, fieldId] of Object.entries(atividadesMap)) {
                    if (atividade.includes(key)) {
                        await page.locator(`[id$="${fieldId}"]`).first().click();
                        console.log(`Atividade: ${atividade}, campo=${fieldId}`)
                    }
                }
            }

            if (empresa.detalhe_atividade) {
                await page.fill('input[id*="Actividad9detalle"]', String(empresa.detalhe_atividade));
            }

        }

        // Áreas de aplicação
        if (empresa.areas_aplicacao && empresa.areas_aplicacao.length > 0) {
            const areaMap = {
                "Produção": "Area1",
                "Logística": "Area2",
                "Vendas": "Area3",
                "Compras": "Area4",
                "Finanças": "Area5",
                "Distribuição": "Area6",
                "Talento": "Area7",
                "Outro": "Area8"
            };

            for (const area of empresa.areas_aplicacao) {
                for (const [key, fieldId] of Object.entries(areaMap)) {
                    if (area.includes(key)) {
                        await page.locator(`[id$="${fieldId}"]`).first().click();
                    }
                }
            }

            if (empresa.detalhe_area) {
                await page.fill('input[id*="Area8detalle"]', String(empresa.detalhe_area));
            }

        }

        // Data de adoção
        if (empresa.data_adocao_praticas) {
            const dataFormatada = new Date(empresa.data_adocao_praticas).toLocaleDateString('pt-BR');
            await page.fill('input[id*="ActividadFecha"]', dataFormatada);
        }

        // Assinatura
        if (empresa.assinatura_nome) {
            await page.fill('input[id*="FirmaNombre"]', empresa.assinatura_nome);
        }
        if (empresa.cargo_representante) {
            await page.fill('input[id*="FirmaCargo"]', empresa.cargo_representante);
        }

        if (empresa.assinatura_data) {
            const dataFormatada = new Date(empresa.assinatura_data).toLocaleDateString('pt-BR');
            await page.fill('input[id*="FirmaFecha"]', dataFormatada);
        }

        // 8. SALVAR
        console.log('Salvando questionário...');
        await page.locator('.dx-button').filter({ hasText: 'Salvar' }).click();
        await page.waitForTimeout(timeout2);

        return {
            empresa: empresa.nome_empresa,
            sucesso: true,
            duracao_ms: Date.now() - inicio
        };

    } catch (error) {

        console.error(`❌ Erro na empresa ${empresa.nome_empresa}`, error);

        return {
            empresa: empresa.nome_empresa,
            sucesso: false,
            erro: error.message,
            duracao_ms: Date.now() - inicio
        };
    }
}


// ======================================================
// 🔹 4. PROCESSAR JOB EM BACKGROUND
// ======================================================

async function processarJob(jobId, empresas, credenciais, isProd) {

    let browser;

    try {

        browser = await criarBrowser(isProd);

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        const page = await context.newPage();

        await fazerLogin(page, credenciais);

        for (const empresa of empresas) {

            const resultado = await executarEmpresa(page, empresa);

            jobs[jobId].resultados.push(resultado);
            jobs[jobId].processadas++;
        }

        jobs[jobId].status = 'finalizado';
        jobs[jobId].fim = new Date().toLocaleString('pt-BR');

        console.log(`✅ JOB ${jobId} finalizado`);

    } catch (error) {

        jobs[jobId].status = 'erro';
        jobs[jobId].erro = error.message;

        console.error(`❌ Erro geral no JOB ${jobId}`, error);

    } finally {

        if (browser) await browser.close();
    }
}


// ======================================================
// 🔹 5. ENDPOINT EMPRESA ÚNICA (MANTÉM SEU PADRÃO)
// ======================================================

app.post('/executar', async (req, res) => {

    let browser;

    try {

        const { empresa, credenciais, isProd } = req.body;

        if (!empresa || !credenciais) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        browser = await criarBrowser(isProd);

        const context = await browser.newContext();
        const page = await context.newPage();

        await fazerLogin(page, credenciais);

        const resultado = await executarEmpresa(page, empresa);

        await browser.close();

        res.json(resultado);

    } catch (error) {

        if (browser) await browser.close();

        res.status(500).json({ erro: error.message });
    }
});


// ======================================================
// 🔹 6. ENDPOINT MÚLTIPLAS EMPRESAS (JOB)
// ======================================================

app.post('/executarJob', async (req, res) => {

    const { empresas, credenciais, isProd } = req.body;

    if (!empresas || !Array.isArray(empresas) || empresas.length === 0) {
        return res.status(400).json({ error: 'Empresas (array) é obrigatório' });
    }

    if (!credenciais) {
        return res.status(400).json({ error: 'Credenciais são obrigatórias' });
    }

    const jobId = uuidv4();

    jobs[jobId] = {
        status: 'running',
        total: empresas.length,
        processadas: 0,
        resultados: [],
        inicio: new Date().toLocaleString('pt-BR')
    };

    res.json({
        success: true,
        job_id: jobId
    });

    processarJob(jobId, empresas, credenciais, isProd);
});


// ======================================================
// 🔹 7. CONSULTAR STATUS
// ======================================================

app.get('/status/:jobId', (req, res) => {

    const job = jobs[req.params.jobId];

    if (!job) {
        return res.status(404).json({ error: 'Job não encontrado' });
    }

    const percentual = ((job.processadas / job.total) * 100).toFixed(1);

    res.json({
        ...job,
        percentual: `${percentual}%`
    });
});


// ======================================================
// 🔹 8. START SERVER
// ======================================================

app.listen(3000, () => {
    console.log("🚀 Servidor rodando na porta 3000");
});
