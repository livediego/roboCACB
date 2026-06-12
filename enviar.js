const { chromium } = require('playwright');

// ======================================================
// 🔹 CONFIG
// ======================================================
const URL_LOGIN = 'https://www.alinvestverde-c1-monitoreo.com/Admin/Login?ReturnUrl=%2FHome';
const URL = 'https://www.alinvestverde-c1-monitoreo.com/Ficha11OE?IdProyectoIndicadorML=291';
const USERNAME = 'Gabriele.Oliveira CACB';
const PASSWORD = '1234567';
const START_PAGE = 78; // Configura a página inicial (1 para começar do início)

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

// Função auxiliar para limpar overlays travados
const clearOverlays = async (page) => {
  await page.evaluate(() => {
    const overlays = document.querySelectorAll('.dx-overlay-wrapper, .dx-overlay-shader, .dx-popup-wrapper');
    overlays.forEach(o => {
      o.style.display = 'none';
      o.style.visibility = 'hidden';
      o.style.opacity = '0';
      o.style.pointerEvents = 'none';
    });
  });
};

// ======================================================
// 🔹 CÓDIGO PRINCIPAL
// ======================================================
(async () => {

  const browser = await chromium.launch({ headless: true });
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
    
    if (START_PAGE > 1) {
      console.log('Avançando rapidamente para a página: ' + START_PAGE + '...');
      while (pageNumber < START_PAGE) {
        await page.waitForSelector('.dx-datagrid-table', { state: 'visible', timeout: 30000 });
        
        const bestPageToClick = await page.evaluate((target) => {
          const pages = Array.from(document.querySelectorAll('.dx-page'))
            .map(p => ({ el: p, num: parseInt(p.innerText) }))
            .filter(p => !isNaN(p.num) && p.num <= target)
            .sort((a, b) => b.num - a.num);
          if (pages.length > 0) {
            const currentPage = parseInt(document.querySelector('.dx-selection.dx-page')?.innerText || '1');
            if (pages[0].num > currentPage) {
              pages[0].el.click();
              return pages[0].num;
            }
          }
          return null;
        }, START_PAGE);

        if (bestPageToClick) {
          pageNumber = bestPageToClick;
          console.log('Saltou para a página ' + pageNumber + '...');
          await page.waitForTimeout(1500);
        } else {
          const nextBtn = await page.$('.dx-navigate-button.dx-next-button:not(.dx-button-disable)');
          if (nextBtn) {
            await nextBtn.click({ force: true });
            await page.waitForTimeout(1500);
            const activePageText = await page.evaluate(() => document.querySelector('.dx-selection.dx-page')?.innerText);
            pageNumber = parseInt(activePageText || (pageNumber + 1));
            console.log('Avançou via seta para a página ' + pageNumber + '...');
          } else {
            break;
          }
        }
      }
    }

    let hasMorePages = true;

    while (hasMorePages) {
      console.log('\n--- Processando Página ' + pageNumber + ' ---');
      
      await page.waitForSelector('.dx-datagrid-table', { state: 'visible', timeout: 30000 });
      await page.waitForTimeout(2000); 
      
      const rowsCount = (await page.$$('.dx-datagrid-rowsview .dx-data-row')).length;

      for (let i = 0; i < rowsCount; i++) {
        const currentRows = await page.$$('.dx-datagrid-rowsview .dx-data-row');
        const row = currentRows[i];
        if (!row) continue;

        try {
          const beneficiaryCell = await row.$('td:nth-child(2)');
          if (!beneficiaryCell) continue;
          const beneficiary = await beneficiaryCell.innerText();
          
          const dateCell = await row.$('td:nth-child(4)');
          if (!dateCell) continue;
          const dateText = (await dateCell.innerText()).trim();

          const reviewBtn = await row.$('a[title="Solicitar revisão"], a[hint="Solicitar revisão"]');
          
          if (dateText === '' && reviewBtn) {
            console.log('Empresa Pendente: ' + beneficiary);
            
            const fileBtn = await row.$('a[title="Arquivo"], a[hint="Arquivo"]');
            if (fileBtn) {
              await fileBtn.scrollIntoViewIfNeeded();
              await fileBtn.click({ force: true });
              
              try {
                console.log('- Aguardando modal de arquivos...');
                // Espera o modal ficar visível de fato
                await page.waitForFunction(() => {
                  const modals = Array.from(document.querySelectorAll('.dx-popup-content'));
                  return modals.some(m => m.getBoundingClientRect().height > 10);
                }, { timeout: 15000 });

                await page.waitForTimeout(2000);

                const fileCount = await page.evaluate(() => {
                  const modals = Array.from(document.querySelectorAll('.dx-popup-content'));
                  const activeModal = modals.find(m => m.getBoundingClientRect().height > 10);
                  if (!activeModal) return 0;
                  
                  const listItems = activeModal.querySelectorAll('.dx-list-item');
                  if (listItems.length > 0) return listItems.length;
                  
                  const gridRows = activeModal.querySelectorAll('.dx-datagrid-rowsview .dx-data-row');
                  if (gridRows.length > 0) return gridRows.length;

                  return activeModal.querySelectorAll('a').length;
                });

                console.log('- Arquivos encontrados: ' + fileCount);

                // Fechar o modal
                await page.evaluate(() => {
                  const modals = Array.from(document.querySelectorAll('.dx-overlay-wrapper'));
                  const activeWrapper = modals.find(m => m.getBoundingClientRect().height > 10);
                  if (activeWrapper) {
                    const closeBtn = activeWrapper.querySelector('.dx-closebutton, .dx-icon-close');
                    if (closeBtn) {
                      const actualBtn = closeBtn.closest('.dx-button') || closeBtn;
                      actualBtn.click();
                    }
                  }
                });
                
                // Espera o modal sumir completamente
                await page.waitForFunction(() => {
                  const overlays = Array.from(document.querySelectorAll('.dx-overlay-wrapper, .dx-overlay-shader'));
                  return overlays.every(o => o.getBoundingClientRect().height < 5);
                }, { timeout: 8000 }).catch(() => {});
                
                await page.waitForTimeout(1500);

                if (fileCount === 1) {
                  console.log('>>> SOLICITANDO REVISÃO para ' + beneficiary + '...');
                  const freshReviewBtn = await page.locator('.dx-data-row', { hasText: beneficiary })
                    .locator('a[title="Solicitar revisão"], a[hint="Solicitar revisão"]')
                    .first();
                  
                  if (await freshReviewBtn.isVisible()) {
                    await freshReviewBtn.click({ force: true });
                    await page.waitForTimeout(2000);
                  }
                } else {
                  console.log('- Pulado: Requisito de exatamente 1 arquivo não atendido (Encontrados: ' + fileCount + ').');
                }

              } catch (modalError) {
                console.log('⚠️ Erro no modal para ' + beneficiary + ': ' + modalError.message);
                await page.keyboard.press('Escape'); 
                await page.waitForTimeout(2000);
              }
            }
          }
        } catch (rowError) {
          console.log('⚠️ Erro ao processar linha ' + (i + 1) + ': ' + rowError.message);
          continue;
        }
      }

      const nextLink = await page.$('.dx-page:has-text("' + (pageNumber + 1) + '")');
      if (nextLink) {
        await nextLink.click({ force: true });
        pageNumber++;
        await page.waitForTimeout(3000);
      } else {
        const nextBtn = await page.$('.dx-navigate-button.dx-next-button:not(.dx-button-disable)');
        if (nextBtn) {
           await nextBtn.click({ force: true });
           await page.waitForTimeout(2000);
           const activePageText = await page.evaluate(() => document.querySelector('.dx-selection.dx-page')?.innerText);
           pageNumber = parseInt(activePageText || (pageNumber + 1));
           await page.waitForTimeout(1000);
        } else {
           hasMorePages = false;
        }
      }
    }

    console.log('\nProcesso finalizado com sucesso.');

  } catch (err) {
    console.error('Falha crítica na automação:', err);
  } finally {
    await browser.close();
  }
})();