const fs = require('fs');
const os = require('os');
const path = require('path');

const TEMP_DIR = path.join(__dirname, '.tmp');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

process.env.TEMP = TEMP_DIR;
process.env.TMP = TEMP_DIR;
process.env.TMPDIR = TEMP_DIR;

const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ======================================================
// 🔹 CONFIG
// ======================================================

const URL_LOGIN = 'https://www.alinvestverde-c1-monitoreo.com/Admin/Login?ReturnUrl=%2FHome';
const WEBHOOK_BASE44_URL = 'https://alinvestverdecacb.com.br/functions/executorWebhook';

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

async function gerarPDF(page, empresa) {
    await page.goto('https://alinvestverdecacb.com.br/DetalhesEmpresa?id=' + empresa.id);
    await page.waitForLoadState('networkidle');

    // Salva o PDF no diretório atual
    await page.pdf({ path: empresa.nome_empresa + '.pdf', format: 'A4' });
    console.log('PDF salvo localmente como ' + empresa.nome_empresa + '.pdf');
    await wait(page, 2000);
};

async function uploadPDF(page, empresa) {
    console.log('📤 Enviando PDF para o servidor...');

    // 1. Definir o path
    const filePath = path.join(__dirname, empresa.nome_empresa + '.pdf');

    // 2. Preparar o listener para capturar a janela de arquivos antes de clicar
    const fileChooserPromise = page.waitForEvent('filechooser');

    // 3. Clicar no botão/div que abre a janela
    await page.locator('div[aria-label="Upload files"]').click();

    // 4. Aguardar o evento disparar e enviar o arquivo
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);
    await wait(page, 5000);

    console.log('Upload concluído.');
}

// ======================================================
// 🔹 PASSOS 3 A 8 (REUTILIZÁVEL PARA QUALQUER QUESTIONÁRIO)
// ======================================================

async function buscarEmpresaNaGrid(page, nomeEmpresa, maxPaginas = 2) {

    console.log('🔎 Procurando empresa a partir da última página...');

    await page.waitForSelector('.dx-page-indexes .dx-page', { timeout: 10000 });
    const paginas = page.locator('.dx-page-indexes .dx-page');
    const lastPage = await paginas.last().innerText();
    console.log("Última página:", lastPage);
    const total = parseInt(lastPage, 10);
    const primeiraPagina = Math.max(0, total - maxPaginas) + 1;
    console.log("Primeira página:", primeiraPagina);

    for (let i = total; i >= primeiraPagina; i--) {

        await paginas.nth(i).click();
        await wait(page, 2000);

        console.log(`Procurando na página página índice ${i}...`);

        const linha = page.locator('.dx-data-row', { hasText: nomeEmpresa });

        if (await linha.count()) {
            console.log(`✅ Empresa encontrada na página índice ${i}`);
            return linha;

        }
    }

    throw new Error(`Empresa ${nomeEmpresa} não encontrada entre as páginas ${primeiraPagina} e ${total}`);
}

async function cadastrarEmpresa(page, empresa) {

    console.log('➕ Clicando no botão +');
    await page.click(".dx-icon-add");
    await wait(page, 2000);

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

        if (empresa.setor_negocios_outro) {
            await page.fill('input[id*="EmpresaSectorDetalle"]', empresa.setor_negocios_outro);
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
        ...(empresa.boas_praticas_processos_cultura || []),
        ...(empresa.boas_praticas_projeto || [])

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

    // Atividades geradas
    if (empresa.atividades_geradas && empresa.atividades_geradas.length > 0) {
        const atividadesMap = {
            "Redesenho de produtos e serviços": "Actividad1",
            "Redesenho de etiquetas, embalagens e recipientes": "Actividad2",
            "Investimento em maquinário": "Actividad3",
            "Investimento em fontes de energia": "Actividad4",
            "Investimento em infraestrutura": "Actividad5",
            "Investimento em treinamento": "Actividad6",
            "Melhoria da comunicação com clientes": "Actividad7",
            "Cumprimento de normas ecológicas": "Actividad8",
            "Outra": "Actividad9"
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

    // Marcar checkboxes de áreas de aplicação
    const areasAplicacao = empresa.areas_aplicacao || [];
    for (let i = 0; i < areasAplicacao.length; i++) {
        if (areasAplicacao[i].valor) {
            console.log(`Marcando área de aplicação nº ${i + 1}, de nome ${areasAplicacao[i].nome} com valor ${areasAplicacao[i].valor}`);
            const areaSelector = `[id$="_Area${i + 1}"]`;
            await page.locator(areaSelector).click();
            await wait(page);
        }
    }

    if (empresa.detalhe_area) {
        await page.fill('input[id*="Area8detalle"]', String(empresa.detalhe_area));
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

    await page.locator('textarea').fill(empresa.certificacao_nome || '');

    // Marcar checkboxes de características de certificações
    const caracteristicasCertificacoes = empresa.certificacao_caracteristicas || [];
    for (let i = 0; i < caracteristicasCertificacoes.length; i++) {
        if (caracteristicasCertificacoes[i].valor) {
            console.log(`Marcando característica de certificação nº ${i + 1}, de nome ${caracteristicasCertificacoes[i].nome} com valor ${caracteristicasCertificacoes[i].valor}`);
            if (i === 0) {
                await page.getByRole('checkbox').first().click();
            } else {
                await page.getByRole('checkbox').nth(i).click();
            }
            await wait(page);
        }
    }

    // Marcar checkboxes de áreas de certificações
    const areasCertificacoes = empresa.certificacao_areas || [];
    for (let i = 0; i < areasCertificacoes.length; i++) {
        if (areasCertificacoes[i].valor) {
            console.log(`Marcando área de certificação nº ${i + 1}, de nome ${areasCertificacoes[i].nome} com valor ${areasCertificacoes[i].valor}`);
            const areaSelector = `[id$="_Area${i + 1}"]`;
            await page.locator(areaSelector).click();
            await wait(page);
        }
    }

    // Preencher detalhe de áreas de certificações se fornecido
    if (empresa.certificacao_outro_detalhe) {
        const detalheSelector = `[id$="_Area8detalle"]`;
        await page.locator(detalheSelector).fill(empresa.certificacao_outro_detalhe);
        await wait(page);
    }

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

    res.status(202).json({
        accepted: true,
        message: "Execução iniciada"
    });

    let browser;
    const inicio = new Date();

    let responseSent = false;

    function formatDuration(ms) {
        const s = Math.floor(ms / 1000);
        const msRem = ms % 1000;
        const hh = Math.floor(s / 3600);
        const mm = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(msRem).padStart(3, '0')}`;
    }

    console.log(`⏱️ Início: ${inicio.toLocaleString('pt-BR')}`);

    try {

        const { empresa, credenciais, isProd, questionarios, excluir } = req.body;

        if (!empresa || !credenciais) {
            responseSent = true;
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        if (excluir) {
            console.log(`🗑️ Excluindo dados da empresa ${empresa.nome_empresa}`);
        } else {
            console.log(`📝 Inserindo dados da empresa ${empresa.nome_empresa}`);
        }

        browser = await chromium.launch({
            headless: isProd,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext();
        const page = await context.newPage();

        if (!excluir) {
            await gerarPDF(page, empresa);
        }

        await fazerLogin(page, credenciais);

        for (const questionario of questionarios) {

            if (excluir) {
                console.log(`🗑️ Excluindo questionário: ${questionario.nome} na url ${questionario.url}`);
            } else {
                console.log(`📝 Preenchendo questionário: ${questionario.nome} na url ${questionario.url}`);
            }

            // Abrir questionário correto
            const urlQuestionario = questionario.url;
            if (!urlQuestionario) {
                throw new Error("Questionário inválido");
            }

            await page.goto(urlQuestionario);
            await page.waitForLoadState('networkidle');

            if (!excluir) {
                await cadastrarEmpresa(page, empresa);
            }

            // Preparar questionário para preenchimento (navegar até a empresa e clicar em editar)

            if (!excluir) {
                console.log('🔎 Procurando empresa na última página...');

                const lastPageButton = page.locator('.dx-page-indexes .dx-page').last();
                await lastPageButton.click();
                await wait(page, 2000);

                const linhaEmpresa = page.locator('.dx-data-row', { hasText: empresa.nome_empresa });
                await linhaEmpresa.locator('.dx-link-edit').first().click();
                await wait(page, 2000);

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

                // Fazer upload do PDF para o questionário

                await linhaEmpresa.locator('.dx-icon-doc').first().click();
                await wait(page, 2000);
                await uploadPDF(page, empresa);
            } else {
                const linhaEmpresa = await buscarEmpresaNaGrid(page, empresa.nome_empresa, 1000);

                await linhaEmpresa.locator('.dx-link-delete').first().click();
                await page.getByRole('button', { name: 'Sim' }).click();
                await wait(page, 2000);
            }
        }

        const fim = new Date();
        const durMs = fim - inicio;
        console.log('Automação concluída com sucesso!');
        console.log(`⏲️ Encerramento: ${fim.toLocaleString('pt-BR')} — Tempo gasto: ${formatDuration(durMs)} (${durMs} ms)`);

        //Envia o webhook de sucesso para o Base44
        await fetch(WEBHOOK_BASE44_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                empresa_id: empresa.id,
                status: 'sucesso',
                message: 'Automação concluída com sucesso',
                duracao_ms: durMs,
            }),
        });
        console.log('Webhook de sucesso enviado para o Base44.');

    } catch (error) {
        const fimErr = new Date();
        const durMsErr = fimErr - inicio;
        console.error(error);
        console.log(`⏲️ Encerramento (erro): ${fimErr.toLocaleString('pt-BR')} — Tempo gasto: ${formatDuration(durMsErr)} (${durMsErr} ms)`);

        //Envia o webhook de falha para o Base44
        await fetch(WEBHOOK_BASE44_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                empresa_id: req.body.empresa?.id, // Tenta pegar o ID da empresa do corpo da requisição
                status: 'falha',
                error: error.message,
                duracao_ms: durMsErr,
            }),
        });
        console.log('Webhook de falha enviado para o Base44.');

    } finally {
        if (browser) await browser.close();
    }
});

// ======================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Executor rodando na porta ${PORT}`);
});