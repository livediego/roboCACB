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

        console.log(`Iniciando automação para: ${empresa.nome_empresa}`);

        // Iniciar navegador
        browser = await chromium.launch({ 
            headless: true,
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

        // CNPJ
        await page.fill('input[name="IdentificacionTributaria"]', empresa.cnpj || '');

        // Nome da Empresa
        await page.fill('input[name="Nombre"]', empresa.nome_empresa || '');

        // Setor
        if (empresa.setor_negocios) {
            const setorIndex = [
                "Agrícola, pecuária, pesqueira, mineradora, florestal",
                "Industrial, agroindústria, manufatureira, processadora, artesanal, farmacêutica",
                "Serviços, turismo, software, segurança, assessoria, transporte, comércio",
                "Inovação, digitalização, conhecimento, gestão da informação",
                "Outro"
            ].indexOf(empresa.setor_negocios);
            
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
        if (empresa.tamanho_empresa) {
            const tamanhoIndex = ["Micro", "Pequena", "Média", "Grande", "Outro"].indexOf(empresa.tamanho_empresa);
            
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

        // Email
        await page.fill('input[name="CorreoElectronico"]', empresa.email || '');

        // Telefone
        await page.fill('input[name="TelefonoEmpresa"]', empresa.telefone || '');

        // Estado
        await page.fill('input[name="Departamento"]', empresa.estado || '');

        // Cidade
        await page.fill('input[name="Ciudad"]', empresa.cidade || '');

        // Nome do Representante
        const nomes = (empresa.nome_representante || '').split(' ');
        await page.fill('input[name="NombreRepresentante"]', nomes[0] || '');
        await page.fill('input[name="ApellidoRepresentante"]', nomes.slice(1).join(' ') || '');

        // Gênero
        if (empresa.genero_representante) {
            const generoIndex = ["Feminino", "Masculino", "Outro/Prefiro não informar"].indexOf(empresa.genero_representante);
            
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
        if (empresa.idade_representante) {
            const idadeIndex = ["17 a 29 anos", "Mais de 29 anos"].indexOf(empresa.idade_representante);
            
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

        // 5. SALVAR
        console.log('Salvando cadastro da empresa...');
        await page.locator('.dx-button').filter({ hasText: 'Guardar' }).click();
        await page.waitForTimeout(3000);

        // 6. NAVEGAR PARA ÚLTIMA PÁGINA
        console.log('Navegando para a última página...');
        const lastPageButton = await page.locator('.dx-page-indexes .dx-page').last();
        await lastPageButton.click();
        await page.waitForTimeout(2000);

        // 7. CLICAR NA EMPRESA
        //console.log('Clicando na empresa adicionada...');
        //await page.click(`text=${empresa.nome_empresa}`);
        //await page.waitForTimeout(1000);

        // 8. EDITAR
        console.log('Clicando em Editar...');
        await page.getByLabel('Editar').last().click();
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
        if (empresa.economia_agua) {
            await page.fill('input[id*="Porcentaje2"]', String(empresa.economia_agua));
        }
        if (empresa.economia_energia_eletrica) {
            await page.fill('input[id*="Porcentaje3"]', String(empresa.economia_energia_eletrica));
        }
        if (empresa.economia_materiais_insumos) {
            await page.fill('input[id*="Porcentaje4"]', String(empresa.economia_materiais_insumos));
            await page.fill('input[id*="Porcentaje5"]', String(empresa.economia_materiais_insumos));
        }
        if (empresa.economia_poluentes) {
            await page.fill('input[id*="Porcentaje6"]', String(empresa.economia_poluentes));
            await page.fill('input[id*="Porcentaje7"]', String(empresa.economia_poluentes));
        }
        if (empresa.economia_reaproveitamento) {
            await page.fill('input[id*="Porcentaje8"]', String(empresa.economia_reaproveitamento));
            await page.fill('input[id*="Porcentaje9"]', String(empresa.economia_reaproveitamento));
            await page.fill('input[id*="Porcentaje10"]', String(empresa.economia_reaproveitamento));
            await page.fill('input[id*="Porcentaje11"]', String(empresa.economia_reaproveitamento));
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
                "Cumprimento de normas ecológicas": "Actividad8"
            };

            for (const melhoria of empresa.melhorias_geradas) {
                for (const [key, fieldId] of Object.entries(melhoriaMap)) {
                    if (melhoria.includes(key)) {
                        const label = page.locator('label', { hasText: key });
                        const checkboxId = await label.getAttribute('for');
                        await page.locator(`#${checkboxId}`).click();
                        await page.waitForTimeout(300);
                    }
                }
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
                "RH": "Area7",
                "Recursos Humanos": "Area7"
            };

            for (const area of empresa.areas_aplicacao) {
                for (const [key, fieldId] of Object.entries(areaMap)) {
                    if (area.includes(key)) {
                        const label = page.locator('label', { hasText: key });
                        const checkboxId = await label.getAttribute('for');
                        await page.locator(`#${fieldId}`).click();
                        await page.waitForTimeout(300);
                    }
                }
            }
        }

        // Data de adoção
        if (empresa.data_adocao_praticas) {
            await page.fill('input[id*="ActividadFecha"]', empresa.data_adocao_praticas);
        }

        // Assinatura
        if (empresa.assinatura_nome) {
            await page.fill('input[id*="FirmaNombre"]', empresa.assinatura_nome);
        }
        if (empresa.cargo_representante) {
            await page.fill('input[id*="FirmaCargo"]', empresa.cargo_representante);
        }
        if (empresa.assinatura_data) {
            const dataAssinatura = new Date(empresa.assinatura_data).toISOString().split('T')[0];
            await page.fill('input[id*="FirmaFecha"]', dataAssinatura);
        }

        // 10. SALVAR
        console.log('Salvando questionário...');
        await page.click('button:has-text("Salvar")');
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