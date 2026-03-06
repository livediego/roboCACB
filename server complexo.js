process.env.TEMP = require('os').tmpdir();
process.env.TMP = require('os').tmpdir();

const express = require('express');
const { chromium } = require('playwright');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ======================================================
// 🔹 CONFIG
// ======================================================

const URL_LOGIN = 'https://www.alinvestverde-c1-monitoreo.com/Admin/Login?ReturnUrl=%2FHome';

// ======================================================
// 🔹 UTILITÁRIOS
// ======================================================

function formatarDataBR(data) {
    if (!data) return '';
    return new Date(data).toLocaleDateString('pt-BR');
}

async function irParaUltimaPagina(page) {
    await page.waitForSelector('.dx-datagrid', { timeout: 30000 });
    await page.waitForSelector('.dx-pager', { timeout: 30000 });

    const btnLast = page.locator('.dx-pager .dx-last-button').first();

    if (await btnLast.count()) {
        await btnLast.click();
        await waitOverlayGone(page, 20000);
    } else {
        // fallback: clica no último botão numérico visível do pager
        const pages = page.locator('.dx-page-indexes .dx-page');
        const total = await pages.count();
        if (!total) throw new Error('Pager sem páginas visíveis.');
        await pages.nth(total - 1).click();
        await waitOverlayGone(page, 20000);
    }

    // garante que as linhas renderizaram
    await page.waitForSelector('.dx-data-row', { timeout: 30000 });
}

async function pegarUltimaLinha(page) {
    const rows = page.locator('.dx-data-row');
    const n = await rows.count();
    if (!n) throw new Error('Grid sem linhas (.dx-data-row).');
    return rows.nth(n - 1);
}

async function abrirUltimoRegistroParaEditar(page, nomeEmpresaEsperado) {
    await irParaUltimaPagina(page);

    // re-localiza a última linha no DOM atual (evita detached)
    const ultimaLinha = await pegarUltimaLinha(page);
    await ultimaLinha.waitFor({ state: 'visible', timeout: 20000 });

    // opcional: valida se bate com o nome esperado
    if (nomeEmpresaEsperado) {
        const txt = (await ultimaLinha.innerText()).toUpperCase();
        if (!txt.includes(String(nomeEmpresaEsperado).toUpperCase())) {
            // tenta 1 refresh leve indo de novo pra última página (às vezes o grid atualiza atrasado)
            await irParaUltimaPagina(page);
            const ultimaLinha2 = await pegarUltimaLinha(page);
            const txt2 = (await ultimaLinha2.innerText()).toUpperCase();
            if (!txt2.includes(String(nomeEmpresaEsperado).toUpperCase())) {
                console.log('⚠️ Última linha não parece ser a empresa esperada. Vou seguir mesmo assim (conforme sua regra).');
            }
            return ultimaLinha2;
        }
    }

    return ultimaLinha;
}

async function gotoWithRetry(page, url, opts = {}, tentativas = 2) {
    let lastErr;
    for (let i = 1; i <= tentativas; i++) {
        try {
            await page.goto(url, opts);
            return;
        } catch (e) {
            lastErr = e;
            console.log(`⚠️ goto falhou (${i}/${tentativas}) em ${url}: ${e.message}`);
            await page.waitForTimeout(1200);
        }
    }
    throw lastErr;
}

async function clickSalvarOuGuardar(page) {
    const btn = page
        .locator('.dx-button')
        .filter({ hasText: /^(Salvar|Guardar)$/i })
        .first();

    await btn.waitFor({ state: 'visible', timeout: 20000 });
    await btn.click();
}

async function selectDxOptionByText(page, text, timeout = 20000) {
    const overlay = await getVisibleDxOverlay(page);

    // tenta clicar no item com texto (mais estável do que nth)
    const option = overlay.locator('.dx-item.dx-list-item[role="option"]', { hasText: text }).first();

    await option.waitFor({ state: 'visible', timeout });
    await option.scrollIntoViewIfNeeded();
    await option.click({ timeout });
}

async function selectDxOptionByIndex(page, index, timeout = 20000) {
    const overlay = await getVisibleDxOverlay(page);

    const options = overlay.locator('.dx-item.dx-list-item[role="option"]');
    const count = await options.count();
    if (index < 0 || index >= count) {
        throw new Error(`Índice ${index} fora do range. Opções visíveis agora: ${count}`);
    }

    const opt = options.nth(index);
    await opt.waitFor({ state: 'visible', timeout });
    await opt.scrollIntoViewIfNeeded();

    // força estabilidade: às vezes a animação do popup deixa "instável"
    await page.waitForTimeout(80);

    // click com tentativa "forçada" como fallback
    try {
        await opt.click({ timeout });
    } catch (e) {
        await opt.click({ timeout, force: true });
    }
}

// ======================================================
// 🔹 WAITS INTELIGENTES (substitui waits fixos)
// ======================================================

async function waitAfterPagerClick(page, timeout = 15000) {
    await page.locator('.dx-page.dx-selection').first().waitFor({ state: 'visible', timeout });
    await waitOverlayGone(page, timeout);
    await page.waitForSelector('.dx-data-row', { timeout });
}

async function waitOverlayGone(page, timeout = 15000) {
    // DevExtreme / overlays comuns
    const overlay = page.locator(
        '.dx-overlay-wrapper, .dx-loadpanel-wrapper, .dx-loadpanel, .dx-overlay-content'
    );

    try {
        if (await overlay.count()) {
            await overlay.first().waitFor({ state: 'hidden', timeout });
        }
    } catch (e) {
        // fallback
        try {
            await overlay.first().waitFor({ state: 'detached', timeout: 3000 });
        } catch (_) { }
    }
}

async function waitGridSettled(page, timeout = 30000) {
    // overlay/carregamento geral
    await waitOverlayGone(page, timeout);

    const grid = page.locator('.dx-datagrid').first();
    await grid.waitFor({ state: 'visible', timeout });

    // carimbo do conteúdo: texto da primeira linha (muda quando vira a página)
    const firstRow = page.locator('.dx-data-row').first();

    // garante que tem pelo menos 1 row e captura um snapshot
    await firstRow.waitFor({ state: 'visible', timeout });
    const snap1 = (await firstRow.innerText()).trim();

    // espera estabilizar: mesmo texto em duas leituras consecutivas
    const start = Date.now();
    while (Date.now() - start < timeout) {
        await page.waitForTimeout(150);
        await waitOverlayGone(page, timeout);

        // se a row sumiu no meio, tenta de novo
        if (!(await firstRow.count())) continue;

        const snap2 = (await firstRow.innerText()).trim();
        if (snap2 && snap2 === snap1) return;

        // atualiza snapshot e segue esperando
        if (snap2) {
            // trocou -> continua até estabilizar
            // (não retorna ainda)
            // próximo loop compara de novo
            // eslint-disable-next-line no-unused-vars
            const _ = 0;
        }
    }

    // se não estabilizou, segue (não quebra) — mas já ajudou muito
}

async function waitGridReady(page, timeout = 45000) {
    // espera a página ter pelo menos um estado "útil"
    const grid = page.locator('.dx-datagrid');
    const addBtn = page.locator('.dx-icon-add'); // seu fluxo depende disso
    const loginUser = page.locator('#UsuarioNombre'); // sinal de que caiu no login
    const errorText = page.getByText('Error', { exact: false });

    // espera QUALQUER um desses aparecer
    await Promise.race([
        grid.first().waitFor({ state: 'visible', timeout }),
        addBtn.first().waitFor({ state: 'visible', timeout }),
        loginUser.first().waitFor({ state: 'visible', timeout }),
        errorText.first().waitFor({ state: 'visible', timeout }).catch(() => { }), // não obrigatório
    ]);

    // se caiu no login, falha com mensagem clara
    if (await loginUser.count()) {
        throw new Error('Sessão caiu/redirect para login ao abrir o questionário.');
    }

    // garante que overlays terminaram
    await waitOverlayGone(page, timeout);
}

async function clickAndWaitOverlay(page, locatorOrSelector) {
    const loc =
        typeof locatorOrSelector === 'string'
            ? page.locator(locatorOrSelector)
            : locatorOrSelector;

    await loc.click();
    await waitOverlayGone(page);
}

async function getVisibleDxOverlay(page) {
    const overlays = page.locator('.dx-dropdowneditor-overlay:visible');
    const n = await overlays.count();
    if (!n) throw new Error('Nenhum overlay visível encontrado para o dropdown.');
    const overlay = overlays.nth(n - 1); // pega o "mais recente"
    await overlay.waitFor({ state: 'visible', timeout: 15000 });
    return overlay;
}
// ======================================================
// 🔹 LOGIN
// ======================================================

async function fazerLogin(page, credenciais) {
    console.log('🔐 Fazendo login...');

    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });

    await page.fill('#UsuarioNombre', credenciais.username);
    await page.fill('#Contrasenia', credenciais.password);

    await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        page.click("button:has-text('Ingresar')"),
    ]);

    await waitOverlayGone(page);
}

// ======================================================
// 🔹 PDF
// ======================================================

async function gerarPDF(page, empresa) {
    const url = 'https://alinvestverdecacb.com.br/DetalhesEmpresa?id=' + empresa.id;

    // tolerante: não prenda em domcontentloaded se a página for chatinha
    await page.goto(url, { waitUntil: 'commit', timeout: 60000 });

    // espera o texto "Carregando detalhes" sumir (se existir)
    const loadingText = page.getByText('Carregando detalhes', { exact: false });

    try {
        // se aparecer, espera ficar hidden/detached
        await loadingText.waitFor({ state: 'visible', timeout: 15000 });
        await loadingText.waitFor({ state: 'hidden', timeout: 60000 });
    } catch (_) {
        // fallback: se nunca apareceu ou não sumiu, tenta esperar rede estabilizar um pouco
        // (não use networkidle, só dá um respiro de render)
        await page.waitForTimeout(1500);
    }

    // Sinal positivo mínimo: garante que a página tem algum conteúdo renderizado
    await page.waitForSelector('body', { timeout: 30000 });

    await page.pdf({ path: `${empresa.nome_empresa}.pdf`, format: 'A4', printBackground: true });
    console.log('PDF salvo localmente como ' + empresa.nome_empresa + '.pdf');
}

async function uploadPDF(page, empresa) {
    console.log('📤 Enviando PDF para o servidor...');

    const fileName = `${empresa.nome_empresa}.pdf`;
    const filePath = path.join(__dirname, fileName);

    // espera o chooser ANTES do clique
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 20000 });

    // botão em espanhol
    await page.getByRole('button', { name: /Cargar/i }).click({ timeout: 20000 });

    const fileChooser = await fileChooserPromise;

    await Promise.all([
        fileChooser.setFiles(filePath),
        page.getByText(fileName, { exact: false }).waitFor({ state: 'visible', timeout: 30000 }),
    ]);

    console.log('✅ Upload concluído.');
}

// ======================================================
// 🔹 PASSOS 3 A 8 (REUTILIZÁVEL PARA QUALQUER QUESTIONÁRIO)
// ======================================================

async function buscarEmpresaNaGrid(page, nomeEmpresa, maxPaginas = 3) {
    console.log('🔎 Procurando empresa a partir da última página...');

    // garante grid + pager disponíveis
    await page.waitForSelector('.dx-datagrid', { timeout: 30000 });
    await page.waitForSelector('.dx-pager', { timeout: 30000 });

    const btnLast = page.locator('.dx-pager .dx-last-button').first();
    const btnPrev = page.locator('.dx-pager .dx-prev-button').first();

    // Vai pra ÚLTIMA página (sem depender de número 63/64)
    if (await btnLast.count()) {
        await btnLast.click();
        await waitOverlayGone(page, 20000);
        await page.waitForSelector('.dx-data-row', { timeout: 20000 });
    } else {
        // fallback: se não existir last-button, segue do jeito antigo (mas isso é raro)
        console.log('⚠️ Não encontrei botão "last".');
    }

    for (let tent = 0; tent < maxPaginas; tent++) {
        // procura na página atual
        const linha = page.locator('.dx-data-row', { hasText: nomeEmpresa }).first();
        if (await linha.count()) {
            console.log(`✅ Empresa encontrada na página atual (tentativa ${tent + 1}/${maxPaginas})`);
            return; // não retorne locator
        }

        console.log(`↩️ Não achei na página atual. Voltando uma página...`);

        // se não tem mais pra voltar, para
        if (!(await btnPrev.count())) break;

        // volta uma página
        await btnPrev.click();
        await waitOverlayGone(page, 20000);
        await page.waitForSelector('.dx-data-row', { timeout: 20000 });
    }

    throw new Error(`Empresa "${nomeEmpresa}" não encontrada nas últimas ${maxPaginas} páginas a partir da última.`);
}

async function cadastrarEmpresa(page, empresa) {
    console.log('➕ Clicando no botão +');
    await clickAndWaitOverlay(page, '.dx-icon-add');

    // espere um campo do formulário (mais confiável que sleep)
    await page.waitForSelector('input[name="IdentificacionTributaria"]', { timeout: 15000 });

    // País
    await page.click('#LPais');
    await selectDxOptionByText(page, 'BRASIL');
    await waitOverlayGone(page);

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
            await selectDxOptionByIndex(page, setorIndex);
            await waitOverlayGone(page);
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
            const combo = await getVisibleDxOverlay(page);
            const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
            await opcoes.nth(tamanhoIndex).click();
            await waitOverlayGone(page);
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
            const combo = await getVisibleDxOverlay(page);
            const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
            await opcoes.nth(generoIndex).click();
            await waitOverlayGone(page);
        }
    }

    // Idade
    if (empresa.idade_representante_id) {
        const idadeIndex = parseInt(empresa.idade_representante_id, 10) - 1;

        if (idadeIndex !== -1) {
            await page.click('#LEdad');
            const combo = await getVisibleDxOverlay(page);
            const opcoes = combo.locator('.dx-item.dx-list-item[role="option"]');
            await opcoes.nth(idadeIndex).click();
            await waitOverlayGone(page);
        }
    }

    console.log('💾 Salvando cadastro');
    await page.locator('.dx-button').filter({ hasText: 'Guardar' }).click();

    // em vez de sleep:
    await waitOverlayGone(page);
    await page.waitForSelector('.dx-datagrid', { timeout: 15000 });
}

async function fechoQuestionario(page, empresa) {
    await page.fill('input[id*="FirmaNombre"]', empresa.assinatura_nome || '');
    await page.fill('input[id*="FirmaCargo"]', empresa.cargo_representante || '');
    await page.fill('input[id*="FirmaFecha"]', formatarDataBR(empresa.assinatura_data));

    console.log('💾 Salvando questionário');
    await clickSalvarOuGuardar(page);

    await waitOverlayGone(page, 20000);
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
        ...(empresa.boas_praticas_projeto || []),
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
        empresa.melhoria_processos_comerciais,
    ];

    for (let i = 0; i < percentuais.length; i++) {
        if (percentuais[i]) {
            await page.fill(`input[id*="Porcentaje${i + 1}"]`, String(percentuais[i]));
        }
    }

    // Atividades geradas
    if (empresa.atividades_geradas && empresa.atividades_geradas.length > 0) {
        const atividadesMap = {
            'Redesenho de produtos e serviços': 'Actividad1',
            'Redesenho de etiquetas, embalagens e recipientes': 'Actividad2',
            'Investimento em maquinário': 'Actividad3',
            'Investimento em fontes de energia': 'Actividad4',
            'Investimento em infraestrutura': 'Actividad5',
            'Investimento em treinamento': 'Actividad6',
            'Melhoria da comunicação com clientes': 'Actividad7',
            'Cumprimento de normas ecológicas': 'Actividad8',
            'Outra': 'Actividad9',
        };

        for (const atividade of empresa.atividades_geradas) {
            for (const [key, fieldId] of Object.entries(atividadesMap)) {
                if (atividade.includes(key)) {
                    await page.locator(`[id$="${fieldId}"]`).first().click();
                    console.log(`Atividade: ${atividade}, campo=${fieldId}`);
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
            console.log(
                `Marcando área de aplicação nº ${i + 1}, de nome ${areasAplicacao[i].nome} com valor ${areasAplicacao[i].valor}`
            );
            const areaSelector = `[id$="_Area${i + 1}"]`;
            await page.locator(areaSelector).click();
            await waitOverlayGone(page);
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
        Mulher: 'Mujer/Women',
        Homem: 'Hombre/Man',
        'Prefere não informar': 'Prefiere no indicar/Prefers not to indicate',
    };

    const empregos = empresa.empregos_sustentaveis || { tabela: [] };

    for (const emprego of empregos.tabela) {
        await page.getByRole('button', { name: 'Adicionar uma linha' }).click();

        await page.getByRole('spinbutton').first().fill(String(emprego.ano));
        await page.getByRole('spinbutton').first().press('Tab');

        await page.getByRole('row', { name: 'Editar   Salvar   Cancelar' }).getByLabel('Selecione').click();
        await page.getByRole('listbox').getByText(sexoMap[emprego.sexo]).click();

        await page.getByRole('row', { name: 'Editar   Salvar   Cancelar' }).getByRole('combobox').press('Tab');

        await page.getByRole('spinbutton').nth(1).fill(String(emprego.formal_sustentavel));
        await page.getByRole('spinbutton').nth(1).press('Tab');

        await page.getByRole('spinbutton').nth(2).fill(String(emprego.informal_sustentavel));
        await page.getByRole('spinbutton').nth(2).press('Tab');

        await page.getByRole('spinbutton').nth(3).fill(String(emprego.formal_digital));
        await page.getByRole('spinbutton').nth(3).press('Tab');

        await page.getByRole('spinbutton').nth(4).fill(String(emprego.informal_digital));

        await page.getByRole('link', { name: 'Salvar' }).click();
        await waitOverlayGone(page);
    }

    // Marcar checkboxes de áreas de empregos verdes
    const areasEmpregos = empresa.areas_empregos_verdes || [];
    for (let i = 0; i < areasEmpregos.length; i++) {
        if (areasEmpregos[i].valor) {
            console.log(
                `Marcando área de emprego verde nº ${i + 1}, de nome ${areasEmpregos[i].nome} com valor ${areasEmpregos[i].valor}`
            );
            const areaSelector = `[id$="_Area${i + 1}"]`;
            await page.locator(areaSelector).click();
            await waitOverlayGone(page);
        }
    }

    // Preencher detalhe de áreas de empregos verdes se fornecido
    if (empresa.detalhe_area_empregos) {
        const detalheSelector = `[id$="_Area8detalle"]`;
        await page.locator(detalheSelector).fill(empresa.detalhe_area_empregos);
        await waitOverlayGone(page);
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
            console.log(
                `Marcando característica de certificação nº ${i + 1}, de nome ${caracteristicasCertificacoes[i].nome} com valor ${caracteristicasCertificacoes[i].valor}`
            );
            if (i === 0) {
                await page.getByRole('checkbox').first().click();
            } else {
                await page.getByRole('checkbox').nth(i).click();
            }
            await waitOverlayGone(page);
        }
    }

    // Marcar checkboxes de áreas de certificações
    const areasCertificacoes = empresa.certificacao_areas || [];
    for (let i = 0; i < areasCertificacoes.length; i++) {
        if (areasCertificacoes[i].valor) {
            console.log(
                `Marcando área de certificação nº ${i + 1}, de nome ${areasCertificacoes[i].nome} com valor ${areasCertificacoes[i].valor}`
            );
            const areaSelector = `[id$="_Area${i + 1}"]`;
            await page.locator(areaSelector).click();
            await waitOverlayGone(page);
        }
    }

    // Preencher detalhe de áreas de certificações se fornecido
    if (empresa.certificacao_outro_detalhe) {
        const detalheSelector = `[id$="_Area8detalle"]`;
        await page.locator(detalheSelector).fill(empresa.certificacao_outro_detalhe);
        await waitOverlayGone(page);
    }

    await fechoQuestionario(page, empresa);
}

async function preencherQuestionario13(page, empresa) {
    console.log('📋 Preenchendo questionário interno 13');
    await page.getByRole('spinbutton', { name: 'Ano de faturamento:' }).fill(String(empresa.ano_faturamento));
    await page.getByRole('spinbutton', { name: 'O volume de negócios é de:' }).fill(String(empresa.volume_negocios));
    await page.locator(`#cbLimite${empresa.aumento_faturamento}`).click();
    await waitOverlayGone(page);
    await fechoQuestionario(page, empresa);
}

async function preencherQuestionario14(page, empresa) {
    console.log('📋 Preenchendo questionário interno 14');

    const percentuaisMap = {
        'Economia de recurso monetário': empresa.economia_recurso_monetario,
        'Economia de água potável': empresa.economia_agua_potavel,
        'Economia de energia elétrica': empresa.economia_energia_eletrica,
        'Economia de matéria prima': empresa.economia_materia_prima,
        'Economia de materiais/insumos': empresa.economia_materiais_insumos,
        'Redução de descargas poluentes': empresa.reducao_descargas_poluentes,
        'Redução de concentração de poluentes': empresa.reducao_concentracao_poluentes,
        'Reutilização de materiais': empresa.reutilizacao_materiais,
        'Reutilização de resíduos': empresa.reutilizacao_residuos,
        'Reciclagem de matéria prima': empresa.reciclagem_materia_prima,
        'Reciclagem de materiais residuais': empresa.reciclagem_materiais_residuais,
        'Melhoria em processos comerciais': empresa.melhoria_processos_comerciais,
    };

    for (const [key, valor] of Object.entries(percentuaisMap)) {
        if (valor) {
            console.log(`Preenchendo ${key} com valor ${valor}`);
            await page.getByRole('button', { name: 'Adicionar uma linha' }).click();
            await page.getByRole('row', { name: 'Editar   Salvar   Cancelar' }).getByRole('textbox').fill(key);
            await page.getByRole('row', { name: 'Editar   Salvar   Cancelar' }).getByRole('textbox').press('Tab');
            await page.getByRole('spinbutton').fill(String(valor));
            await page.getByRole('link', { name: 'Salvar' }).click();
            await waitOverlayGone(page);
        }
    }

    await fechoQuestionario(page, empresa);
}

// ======================================================
// 🔹 ENDPOINT PRINCIPAL
// ======================================================

// ======================================================
// 🔹 ENDPOINT PRINCIPAL
// ======================================================

app.post('/executar', async (req, res) => {

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

    console.log(`⏱️ Início: ${inicio.toLocaleString('pt-BR')}`);

    try {

        const { empresa, credenciais, isProd, questionarios, excluir } = req.body;

        if (!empresa || !credenciais) {
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

        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(90000);

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

            const urlQuestionario = questionario.url;
            if (!urlQuestionario) {
                throw new Error("Questionário inválido");
            }

            await gotoWithRetry(page, urlQuestionario, { waitUntil: 'commit', timeout: 90000 }, 2);
            await waitGridReady(page);

            if (!excluir) {
                await cadastrarEmpresa(page, empresa);
                await waitGridReady(page);
            }

            const linhaEmpresa = await abrirUltimoRegistroParaEditar(page, empresa.nome_empresa);

            if (!excluir) {

                await linhaEmpresa.locator('.dx-link-edit').click();
                await waitOverlayGone(page, 15000);

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

                await linhaEmpresa.locator('.dx-icon-doc').click();
                await waitOverlayGone(page, 15000); // deixa o modal abrir
                await page.getByRole('button', { name: /Cargar/i }).waitFor({ state: 'visible', timeout: 20000 });
                await uploadPDF(page, empresa);

            } else {

                await linhaEmpresa.locator('.dx-link-delete').click();
                await page.getByRole('button', { name: 'Sim' }).click();
                await waitOverlayGone(page);

            }
        }

        const fim = new Date();
        const durMs = fim - inicio;

        console.log('Automação concluída com sucesso!');
        console.log(`⏲️ Encerramento: ${fim.toLocaleString('pt-BR')} — Tempo gasto: ${formatDuration(durMs)}`);

        res.json({
            success: true,
            message: 'Automação concluída com sucesso',
            empresa: empresa.nome_empresa,
            inicio: inicio.toISOString(),
            fim: fim.toISOString(),
            duracao_ms: durMs,
            duracao_hms_ms: formatDuration(durMs)
        });

    } catch (error) {

        const fimErr = new Date();
        const durMsErr = fimErr - inicio;

        console.error(error);

        res.status(500).json({
            error: error.message,
            inicio: inicio.toISOString(),
            fim: fimErr.toISOString(),
            duracao_ms: durMsErr,
            duracao_hms_ms: formatDuration(durMsErr)
        });

    } finally {
        if (browser) await browser.close();
    }

});

//======================================================
const PORT = 3000;

app.listen(PORT, () => {
    console.log(`🚀 Executor rodando na porta ${PORT}`);
});