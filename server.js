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

function normalizarNomeEmpresa(txt) {
    return String(txt || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[.,;:]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

function nomeValido(nome) {
    if (!nome) return false;
    if (nome.length < 3) return false;
    if (!/[A-Z0-9]/.test(nome)) return false;
    if (/^[^A-Z0-9]+$/.test(nome)) return false;
    return true;
}

async function pesquisarEmpresasNaGrid(page, empresas, questionarioNome) {
    console.log(`🔎 Pesquisando empresas no questionário ${questionarioNome}...`);

    const empresasNormalizadas = empresas
        .map(e => ({
            id_empresa: e.id_empresa || e.id || e.empresa_id,
            nome_original: e.nome_empresa || e.nome || e.Nombre || e.Nome || '',
            nome_normalizado: normalizarNomeEmpresa(e.nome_empresa || e.nome || e.Nombre || e.Nome || '')
        }))
        .filter(e => nomeValido(e.nome_normalizado));

    const mapaEmpresas = new Map(
        empresasNormalizadas.map(e => [e.nome_normalizado, e])
    );

    const encontradas = [];

    await page.waitForSelector('.dx-page-indexes .dx-page', { timeout: 10000 });

    const paginas = page.locator('.dx-page-indexes .dx-page');
    const lastPageText = await paginas.last().innerText();
    const totalPaginas = parseInt(lastPageText, 10);

    console.log(`📄 Total de páginas detectado: ${totalPaginas}`);

    for (let pagina = 1; pagina <= totalPaginas; pagina++) {
        console.log(`🔎 Verificando página ${pagina} de ${totalPaginas}...`);

        const botaoPagina = page
            .locator('.dx-page-indexes .dx-page')
            .filter({ hasText: new RegExp(`^${pagina}$`) });

        if (!(await botaoPagina.count())) {
            console.log(`⚠️ Página ${pagina} não visível. Pulando.`);
            continue;
        }

        await botaoPagina.first().click();
        await wait(page, 2000);

        const linhas = page.locator('.dx-data-row');
        const totalLinhas = await linhas.count();

        for (let i = 0; i < totalLinhas; i++) {
            const linha = linhas.nth(i);

            const celulas = await linha.locator('td').evaluateAll(tds =>
                tds.map(td => td.innerText.trim()).filter(Boolean)
            ).catch(() => []);

            const candidatos = celulas
                .map(normalizarNomeEmpresa)
                .filter(nomeValido);

            for (const candidato of candidatos) {
                if (mapaEmpresas.has(candidato)) {
                    const empresa = mapaEmpresas.get(candidato);

                    console.log(`✅ Encontrada: ${empresa.nome_original} | Questionário: ${questionarioNome}`);

                    encontradas.push({
                        id_empresa: empresa.id_empresa,
                        nome_empresa: empresa.nome_original,
                        nome_normalizado: empresa.nome_normalizado,
                        questionario: questionarioNome,
                        pagina,
                        linha: i + 1
                    });
                }
            }
        }
    }

    return encontradas;
}

async function excluirEmpresasDaListaNaGrid(page, nomesEmpresas, maxPaginas = 1000) {
    console.log('🗑️ Procurando empresas da lista na grid (última → primeira)...');

    const nomesNormalizados = (nomesEmpresas || [])
        .map(e => typeof e === 'string' ? e : e.nome_empresa || e.nome || e.Nombre || e.Nome || '')
        .map(normalizarNomeEmpresa)
        .filter(nomeValido);

    const nomesSet = new Set(nomesNormalizados);

    await page.waitForSelector('.dx-page-indexes .dx-page', { timeout: 10000 });
    const paginas = page.locator('.dx-page-indexes .dx-page');
    const lastPage = await paginas.last().innerText();
    console.log("Última página:", lastPage);
    const total = parseInt(lastPage, 10);
    const primeiraPagina = Math.max(0, total - maxPaginas) + 1;
    console.log("Primeira página:", primeiraPagina);

    console.log(`📋 Empresas recebidas: ${nomesEmpresas.length}`);
    console.log(`📋 Empresas válidas: ${nomesNormalizados.length}`);
    console.log('🔄 Primeiras empresas normalizadas:', nomesNormalizados.slice(0, 10)); Math.max(1, total - maxPaginas + 1);

    console.log('Primeira página (limite):', primeiraPagina);
    console.log('Última página:', total);

    let totalExcluidas = 0;
    const excluidas = [];

    for (let pagina = total; pagina >= primeiraPagina; pagina--) {
        console.log(`\n🔎 Procurando na página ${pagina}...`);

        const botaoPagina = page
            .locator('.dx-page-indexes .dx-page')
            .filter({ hasText: new RegExp(`^${pagina}$`) });

        const qtdBotoesPagina = await botaoPagina.count();
        console.log(`🔢 Botões encontrados para página ${pagina}: ${qtdBotoesPagina}`);

        if (!qtdBotoesPagina) {
            console.log(`⚠️ Página ${pagina} não visível. Tentando voltar...`);

            const prev = page.locator('.dx-page-prev');

            if (await prev.count()) {
                await prev.click();
                await wait(page, 1000);
                pagina++; // tenta novamente a mesma página
                continue;
            }

            console.log('❌ Não foi possível navegar para a página.');
            continue;
        }

        await botaoPagina.first().click();
        await wait(page, 2000);

        const paginaSelecionada = await page
            .locator('.dx-page.dx-selection')
            .innerText()
            .catch(() => 'NÃO IDENTIFICADA');

        console.log(`📍 Página selecionada após clique: ${paginaSelecionada}`);

        const linhas = page.locator('.dx-data-row');
        const totalLinhas = await linhas.count();

        console.log(`📄 Total de linhas visíveis: ${totalLinhas}`);

        // Amostra das linhas
        for (let amostra = 0; amostra < Math.min(3, totalLinhas); amostra++) {
            const linhaAmostra = linhas.nth(amostra);
            const textoBruto = await linhaAmostra.innerText().catch(() => '');
            const celulas = await linhaAmostra.locator('td').evaluateAll(tds =>
                tds.map(td => td.innerText.trim()).filter(Boolean)
            ).catch(() => []);

            const candidatos = celulas
                .map(normalizarNomeEmpresa)
                .filter(nomeValido);

            console.log(`🧪 Amostra linha ${amostra + 1}:`);
            console.log(`   Texto bruto: ${JSON.stringify(textoBruto)}`);
            console.log(`   Células: ${JSON.stringify(celulas)}`);
            console.log(`   Candidatos: ${JSON.stringify(candidatos)}`);
            const totalLinhasAtualizadas = await linhas.count();

            let encontrou = null;

            for (let i = 0; i < totalLinhasAtualizadas; i++) {
                const linha = linhas.nth(i);

                const textoLinha = await linha.innerText().catch(() => '');
                const celulas = await linha.locator('td').evaluateAll(tds =>
                    tds.map(td => td.innerText.trim()).filter(Boolean)
                ).catch(() => []);

                const candidatos = celulas
                    .map(normalizarNomeEmpresa)
                    .filter(nomeValido);

                const nomeEncontrado = candidatos.find(candidato =>
                    nomesSet.has(candidato)
                );

                if (nomeEncontrado) {
                    encontrou = {
                        nome: nomeEncontrado,
                        textoLinha,
                        rowIndex: i
                    };
                    break;
                }
            }

            if (!encontrou) {
                console.log('ℹ️ Nenhuma empresa da lista nesta página.');
                continue;
            }

            console.log(`✅ Empresa encontrada: "${encontrou.nome}"`);
            console.log(`📎 Texto: ${JSON.stringify(encontrou.textoLinha)}`);

            const linhaParaDeletar = page.locator('.dx-data-row').nth(encontrou.rowIndex);

            await linhaParaDeletar.locator('.dx-link-delete').first().click();
            await wait(page, 1000);

            const botaoConfirmar = page
                .locator('.dx-dialog-button, .dx-button')
                .filter({ hasText: /^(Sim|Sí|Si|Yes|OK|Aceptar|Aceitar)$/i })
                .first();

            if (!(await botaoConfirmar.count())) {
                throw new Error(`Confirmação não encontrada: ${encontrou.nome}`);
            }

            await botaoConfirmar.click();
            await wait(page, 2500);

            totalExcluidas++;
            excluidas.push(encontrou.nome);

            console.log(`🗑️ Excluída: "${encontrou.nome}"`);

            // Since we deleted one, stay on the same page to delete more if any
            pagina++;
        }

        console.log(`✅ Total excluídas: ${totalExcluidas}`);

        return {
            totalExcluidas,
            excluidas
        };
    }
}

async function buscarEmpresaNaGrid(page, nomeEmpresa, maxPaginas = 2) {

    console.log('🔎 Procurando empresa a partir da última página...');

    await page.waitForSelector('.dx-page-indexes .dx-page', { timeout: 10000 });
    const paginas = page.locator('.dx-page-indexes .dx-page');
    const lastPage = await paginas.last().innerText();
    console.log("Última página:", lastPage);
    const total = parseInt(lastPage, 10);
    const primeiraPagina = Math.max(0, total - maxPaginas) + 1;
    console.log("Primeira página:", primeiraPagina);

    for (let i = primeiraPagina; i <= total; i++) {

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
// 🔹 ENDPOINTS
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

app.post('/pesquisar-empresas-questionarios', async (req, res) => {
    let browser;
    const inicio = new Date();

    try {
        const { credenciais, isProd, empresas, questionarios } = req.body;

        if (!credenciais?.username || !credenciais?.password) {
            return res.status(400).json({
                success: false,
                error: 'Credenciais obrigatórias.'
            });
        }

        if (!Array.isArray(empresas) || empresas.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Lista de empresas obrigatória.'
            });
        }

        if (!Array.isArray(questionarios) || questionarios.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Lista de questionários obrigatória.'
            });
        }

        browser = await chromium.launch({
            headless: isProd !== false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext();
        const page = await context.newPage();

        await fazerLogin(page, credenciais);

        const resultadoMap = new Map();

        for (const empresa of empresas) {
            const idEmpresa = empresa.id_empresa || empresa.id || empresa.empresa_id;
            const nomeEmpresa = empresa.nome_empresa || empresa.nome || empresa.Nombre || empresa.Nome || '';

            resultadoMap.set(String(idEmpresa), {
                id_empresa: idEmpresa,
                nome_empresa: nomeEmpresa,
                questionarios_encontrados: []
            });
        }

        for (const questionario of questionarios) {
            if (!questionario.url) {
                throw new Error(`Questionário sem URL: ${questionario.nome || 'sem nome'}`);
            }

            console.log('----------------------------------------');
            console.log(`📋 Pesquisando questionário: ${questionario.nome}`);
            console.log(`URL: ${questionario.url}`);

            await page.goto(questionario.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await wait(page, 3000);

            const encontradas = await pesquisarEmpresasNaGrid(
                page,
                empresas,
                questionario.nome
            );

            for (const item of encontradas) {
                const chave = String(item.id_empresa);

                if (!resultadoMap.has(chave)) {
                    resultadoMap.set(chave, {
                        id_empresa: item.id_empresa,
                        nome_empresa: item.nome_empresa,
                        questionarios_encontrados: []
                    });
                }

                const registro = resultadoMap.get(chave);

                const jaExiste = registro.questionarios_encontrados.some(q =>
                    q.nome === item.questionario
                );

                if (!jaExiste) {
                    registro.questionarios_encontrados.push({
                        nome: item.questionario,
                        pagina: item.pagina,
                        linha: item.linha
                    });
                }
            }
        }

        const resultado = Array.from(resultadoMap.values());

        const fim = new Date();
        const duracaoMs = fim - inicio;

        return res.json({
            success: true,
            message: 'Pesquisa concluída.',
            duracao_ms: duracaoMs,
            resultado
        });

    } catch (error) {
        console.error('❌ Erro na pesquisa:', error);

        return res.status(500).json({
            success: false,
            error: error.message
        });

    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

app.post('/excluir-lote', async (req, res) => {
    let browser;
    const inicio = new Date();

    function formatDuration(ms) {
        const s = Math.floor(ms / 1000);
        const msRem = ms % 1000;
        const hh = Math.floor(s / 3600);
        const mm = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(msRem).padStart(3, '0')}`;
    }

    try {
        const { credenciais, isProd, empresas, questionarios } = req.body;

        if (!credenciais?.username || !credenciais?.password) {
            return res.status(400).json({
                success: false,
                error: 'Credenciais obrigatórias.'
            });
        }

        if (!Array.isArray(empresas) || empresas.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Lista de empresas obrigatória.'
            });
        }

        if (!Array.isArray(questionarios) || questionarios.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Lista de questionários obrigatória.'
            });
        }

        console.log('🗑️ Iniciando robô de exclusão em lote...');
        console.log(`Empresas recebidas: ${empresas.length}`);

        browser = await chromium.launch({
            headless: isProd,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext();
        const page = await context.newPage();

        await fazerLogin(page, credenciais);

        const resultadoGeral = [];

        for (const questionario of questionarios) {
            if (!questionario.url) {
                throw new Error(`Questionário sem URL: ${questionario.nome || 'sem nome'}`);
            }

            console.log('----------------------------------------');
            console.log(`🗑️ Processando questionário: ${questionario.nome}`);
            console.log(`URL: ${questionario.url}`);

            await page.goto(questionario.url);
            await page.waitForLoadState('networkidle');
            await wait(page, 2000);

            const resultado = await excluirEmpresasDaListaNaGrid(page, empresas);

            resultadoGeral.push({
                questionario: questionario.nome,
                url: questionario.url,
                ...resultado
            });
        }

        const fim = new Date();
        const durMs = fim - inicio;

        console.log(`✅ Exclusão em lote concluída em ${formatDuration(durMs)}`);

        return res.json({
            success: true,
            message: 'Exclusão em lote concluída.',
            duracao_ms: durMs,
            resultado: resultadoGeral
        });

    } catch (error) {
        const fimErr = new Date();
        const durMsErr = fimErr - inicio;

        console.error('❌ Erro na exclusão em lote:', error);
        console.log(`⏲️ Encerramento com erro: ${formatDuration(durMsErr)}`);

        return res.status(500).json({
            success: false,
            error: error.message,
            duracao_ms: durMsErr
        });

    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// ======================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Executor rodando na porta ${PORT}`);
});