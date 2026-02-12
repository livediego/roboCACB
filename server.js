const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/executar', async (req, res) => {
    let browser;

    try {
        const { empresa, credenciais, questionario } = req.body;

        if (!empresa || !credenciais) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        console.log('================ EMPRESA (RAW) ================');
        console.dir(empresa, { depth: null });
        console.log('==============================================');

        console.log(`Iniciando automação para: ${empresa.nome_empresa}`);

        // Iniciar navegador
        browser = await chromium.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });

        const page = await context.newPage();

        // 1. LOGIN
        console.log('Fazendo login...');
        await page.goto('https://www.alinvestverde-c1-monitoreo.com/Admin/Login?ReturnUrl=%2FHome');
        await page.fill("//input[@id='UsuarioNombre']", credenciais.username);
        await page.fill("//input[@id='Contrasenia']", credenciais.password);
        await page.click("//button[normalize-space()='Ingresar']");
        await page.waitForLoadState('networkidle');

        // 2. NAVEGAR PARA O QUESTIONÁRIO 11OE
        console.log('Navegando para o questionário...');
        await page.goto('https://www.alinvestverde-c1-monitoreo.com/Ficha11OE?IdProyectoIndicadorML=291');
        await page.waitForLoadState('networkidle');

        // 3. CLICAR NO BOTÃO "+"
        console.log('Clicando no botão +...');
        await page.click("//i[@class='dx-icon dx-icon-add']");
        await page.waitForTimeout(2000);

        // 4. PREENCHER FORMULÁRIO DE CADASTRO DA EMPRESA
        console.log('Preenchendo formulário de cadastro...');

        // País: Brasil
        await page.click('#LPais');
        await page.waitForTimeout(500);
        await page.click('text=BRASIL');
        await page.waitForTimeout(500);

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

        // Nome do Representante
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

        //await new Promise(resolve => {
        //   process.stdin.resume();
        //    process.stdin.once('data', resolve);
        //});


        // 5. SALVAR
        console.log('Salvando cadastro da empresa...');
        await page.locator('.dx-button').filter({ hasText: 'Guardar' }).click();
        await page.waitForTimeout(6000);

        // 6. NAVEGAR PARA ÚLTIMA PÁGINA
        console.log('Navegando para a última página...');
        const lastPageButton = page.locator('.dx-page-indexes .dx-page').last();
        await lastPageButton.click();
        await page.waitForTimeout(2000);

        // 7. CLICAR NA EMPRESA
        //console.log('Clicando na empresa adicionada...');
        //await page.click(`text=${empresa.nome_empresa}`);
        //await page.waitForTimeout(1000);

        // 8. EDITAR
        console.log('Clicando em Editar...');
        //await page.getByLabel('Editar').last().click();
        const linhaEmpresa = page.locator('.dx-data-row', {
            hasText: empresa.nome_empresa
        });

        await linhaEmpresa
            .locator('a.dx-link.dx-link-edit.dx-icon-edit')
            .click();

        await page.waitForTimeout(2000);

        // 9. PREENCHER QUESTIONÁRIO INTERNO
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

        // Melhorias geradas
        if (empresa.melhorias_geradas && empresa.melhorias_geradas.length > 0) {
            const melhoriaMap = {
                "Redesenho de produtos": "Actividad1",
                "Redesenho de embalagens": "Actividad2",
                "Investimento em maquinário eficiente": "Actividad3",
                "Investimento em energia renovável": "Actividad4",
                "Investimento em infraestrutura sustentável": "Actividad5",
                "Treinamento em produção sustentável": "Actividad6",
                "Melhoria na comunicação com clientes": "Actividad7",
                "Cumprimento de normas ecológicas": "Actividad8",
                "Outro": "Actividad9"
            };

            for (const melhoria of empresa.melhorias_geradas) {
                for (const [key, fieldId] of Object.entries(melhoriaMap)) {
                    if (melhoria.includes(key)) {
                        // const label = page.locator('label', { hasText: key }).first();
                        // const checkboxId = await label.getAttribute('for');
                        // await page.locator(`#${checkboxId}`).click();
                        await page.locator(`[id$="${fieldId}"]`).first().click();
                        console.log(`Melhoria: ${melhoria}, campo=${fieldId}`)
                        //id="dx_dx-ad19541e-87fe-b4df-4f7a-161fabcd4c49_Actividad9"
                        //await page.locator('div', { hasText: fieldId }).first().click();
                    }
                }
            }

            if (empresa.detalhe_atividade) {
                //const label = page.locator('label', { hasText: "Actividad9detalle" });
                //const checkboxId = await label.getAttribute('for');
                //await page.locator(`#${checkboxId}`).click();
                await page.fill('input[id*="Actividad9detalle"]', String(empresa.detalhe_atividade));
                //await page.locator('div', { hasText: "Actividad9detalle" }).first().click();
            }

        }

        // Áreas de aplicação
        if (empresa.areas_aplicacao && empresa.areas_aplicacao.length > 0) {
            const areaMap = {
                /*"Produção": "Produção:",
                "Logística": "Logística:",
                "Vendas": "Vendas - marketing:",
                "Compras": "Compras - abastecimiento:",
                "Finanças": "Finanças - contabilidade:",
                "Distribuição": "Distribuição:",
                "Talento": "Talento humano:",
                "Outro:": "Outro:"*/
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
                        //const label = page.locator('label', { hasText: fieldLabel }).first();
                        //const checkboxId = await label.getAttribute('for');
                        //await page.locator(`#${checkboxId}`).click();
                        await page.locator(`[id$="${fieldId}"]`).first().click();
                        // await page.locator('div', { hasText: fieldId }).first().click();
                    }
                }
            }

            if (empresa.detalhe_area) {
                //const label = page.locator('label', { hasText: "Area8detalle" });
                //const checkboxId = await label.getAttribute('for');
                //await page.locator(`#${checkboxId}`).click();
                await page.fill('input[id*="Area8detalle"]', String(empresa.detalhe_area));
                //await page.locator('div', { hasText: "ActividaArea8detalle" }).first().click();
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

        /* await new Promise(resolve => {
             process.stdin.resume();
             process.stdin.once('data', resolve);
         });*/


        // 10. SALVAR
        console.log('Salvando questionário...');
        await page.locator('.dx-button').filter({ hasText: 'Salvar' }).click();
        await page.waitForTimeout(2000);

        console.log('Automação concluída com sucesso!');

        res.json({
            success: true,
            message: 'Questionário preenchido com sucesso',
            empresa: empresa.nome_empresa
        });

    } catch (error) {
        console.error('Erro na automação:', error);
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Executor Playwright rodando na porta ${PORT}`);
});