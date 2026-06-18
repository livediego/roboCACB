const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ======================================================
// 🔹 CONFIG
// ======================================================
const URL_LOGIN = 'https://www.alinvestverde-c1-monitoreo.com/Admin/Login?ReturnUrl=%2FHome';
const URL = 'https://www.alinvestverde-c1-monitoreo.com/Ficha11OE?IdProyectoIndicadorML=291';
const USERNAME = 'Gabriele.Oliveira CACB';
const PASSWORD = '1234567';
const START_PAGE = 249;

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
  await page.waitForFunction(() => !window.location.href.includes('/Admin/Login'), { timeout: 60000 });
  await page.waitForLoadState('domcontentloaded').catch(() => { });
  console.log('✅ Login concluído');
}

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
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    let credenciais = { username: USERNAME, password: PASSWORD };
    await fazerLogin(page, credenciais);
    console.log(`\n🔍 Acessando página de monitoramento...`);

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle').catch(() => { });
    await wait(page, 2000);

    await page.waitForSelector('.dx-page', {
      timeout: 30000
    });

    // Vai para a última página visível
    const lastPage = await page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll('.dx-page'))
        .map(p => parseInt(p.innerText))
        .filter(n => !isNaN(n));

      return Math.max(...pages);
    });

    console.log('Última página visível: ' + lastPage);

    await page.evaluate((target) => {
      const pageBtn = Array.from(
        document.querySelectorAll('.dx-page')
      ).find(
        p => parseInt(p.innerText) === target
      );

      if (pageBtn) pageBtn.click();
    }, lastPage);

    await page.waitForLoadState('networkidle').catch(() => { });
    await page.waitForTimeout(3000);

    let pageNumber = await page.evaluate(() =>
      parseInt(
        document.querySelector('.dx-selection.dx-page')?.innerText || '1'
      )
    );

    console.log('Página inicial: ' + pageNumber);

    let hasMorePages = true;

    while (hasMorePages) {

      console.log(`\n--- Processando Página ${pageNumber} ---`);

      await page.waitForSelector(
        '.dx-datagrid-table',
        { state: 'visible', timeout: 30000 }
      );

      await page.waitForTimeout(2000);

      let rows = await page.$$('.dx-datagrid-rowsview .dx-data-row');

      for (let i = rows.length - 1; i >= 0; i--) {

        rows = await page.$$('.dx-datagrid-rowsview .dx-data-row');

        if (!rows[i]) continue;

        const row = rows[i];

        try {

          const beneficiaryCell =
            await row.$('td:nth-child(2)');

          if (!beneficiaryCell) continue;

          const beneficiary =
            (await beneficiaryCell.innerText()).trim();

          const dateCell =
            await row.$('td:nth-child(4)');

          if (!dateCell) continue;

          const dateText =
            (await dateCell.innerText()).trim();

          const reviewBtn =
            await row.$(
              'a[title="Solicitar revisão"], a[hint="Solicitar revisão"]'
            );

          if (dateText !== '' || !reviewBtn)
            continue;

          console.log('Empresa Pendente: ' + beneficiary);

          const fileBtn =
            await row.$(
              'a[title="Arquivo"], a[hint="Arquivo"]'
            );

          if (!fileBtn)
            continue;

          await fileBtn.scrollIntoViewIfNeeded();
          await fileBtn.click({ force: true });

          await page.waitForFunction(() => {
            const modals =
              Array.from(
                document.querySelectorAll('.dx-popup-content')
              );

            return modals.some(
              m => m.getBoundingClientRect().height > 10
            );
          }, { timeout: 15000 });

          await page.waitForTimeout(2000);

          const fileCount =
            await page.evaluate(() => {

              const modals =
                Array.from(
                  document.querySelectorAll('.dx-popup-content')
                );

              const activeModal =
                modals.find(
                  m => m.getBoundingClientRect().height > 10
                );

              if (!activeModal)
                return 0;

              const listItems =
                activeModal.querySelectorAll('.dx-list-item');

              if (listItems.length)
                return listItems.length;

              const gridRows =
                activeModal.querySelectorAll(
                  '.dx-datagrid-rowsview .dx-data-row'
                );

              if (gridRows.length)
                return gridRows.length;

              return activeModal.querySelectorAll('a').length;
            });

          console.log(
            'Arquivos encontrados: ' + fileCount
          );

          await page.keyboard.press('Escape');
          await page.waitForTimeout(1500);

          if (fileCount !== 1)
            continue;

          const freshReviewBtn =
            page.locator(
              '.dx-data-row',
              { hasText: beneficiary }
            )
              .locator(
                'a[title="Solicitar revisão"], a[hint="Solicitar revisão"]'
              )
              .first();

          if (!(await freshReviewBtn.count()))
            continue;

          console.log(
            '>>> SOLICITANDO REVISÃO: ' + beneficiary
          );

          await freshReviewBtn.click({
            force: true
          });

          await page.waitForLoadState(
            'networkidle'
          ).catch(() => { });

          await page.waitForFunction(() => {

            const loading =
              document.querySelector(
                '.dx-loadpanel-content'
              );

            if (!loading)
              return true;

            return loading.offsetParent === null;

          }, {
            timeout: 30000
          }).catch(() => { });

          await page.waitForTimeout(4000);

        } catch (err) {

          console.log(
            'Erro: ' + err.message
          );

        }
      }

      if (pageNumber <= 1) {

        console.log('🏁 Primeira página alcançada.');
        hasMorePages = false;
        break;

      }

      const targetPage = pageNumber - 1;

      console.log(`⬅ Indo para página ${targetPage}`);

      const changed = await page.evaluate((target) => {

        const pages = Array.from(
          document.querySelectorAll('.dx-page')
        );

        const btn = pages.find(
          p => parseInt(p.innerText) === target
        );

        if (!btn) return false;

        btn.click();

        return true;

      }, targetPage);

      if (!changed) {

        console.log(
          `⚠ Página ${targetPage} não está visível na paginação`
        );

        hasMorePages = false;
        break;

      }

      await page.waitForLoadState('networkidle').catch(() => { });
      await page.waitForTimeout(3000);

      pageNumber = targetPage;

      console.log(`✅ Agora na página ${pageNumber}`);
    }

    console.log('\nProcesso finalizado com sucesso.');

  } catch (err) {
    console.error('Falha crítica na automação:', err);
  } finally {
    await browser.close();
  }
})();
