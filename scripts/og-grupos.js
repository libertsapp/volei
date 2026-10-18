// Roda no build do Vercel (vercel.json), depois de copiar o app para publicar/. O Vercel serve volei.memberstars.com
// (todos os grupos independentes) com o MESMO HTML do Terça; a prévia do link (WhatsApp etc.) é lida sem JavaScript,
// então sem isto todo grupo apareceria como "Vôlei de Terça". Troca o bloco <!-- og:inicio --> ... <!-- og:fim -->
// por uma prévia genérica e copia a imagem dela. memberstars.com/volei (GitHub Pages) continua com a do Terça.
// Uso: node scripts/og-grupos.js [pasta]   (padrão: publicar)
const fs = require('fs');
const path = require('path');

const PREVIA_GRUPOS = `<!-- og:inicio — prévia genérica dos grupos (scripts/og-grupos.js) -->
<meta name="description" content="Lista de presença, sorteio dos times, ranking e votação do craque — tudo no celular.">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="MemberStars Vôlei">
<meta property="og:title" content="Vôlei do grupo — confirme sua presença">
<meta property="og:description" content="Lista de presença, sorteio dos times, ranking e votação do craque — tudo no celular.">
<meta property="og:image" content="https://volei.memberstars.com/og-grupos.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Vôlei do grupo — app MemberStars">
<meta name="twitter:card" content="summary_large_image">
<!-- og:fim -->`;

function trocarPrevia(html) {
  const ini = html.indexOf('<!-- og:inicio');
  const fimMarca = '<!-- og:fim -->';
  const fim = html.indexOf(fimMarca);
  if (ini < 0 || fim < ini) throw new Error('og-grupos: bloco <!-- og:inicio --> ... <!-- og:fim --> não encontrado');
  return html.slice(0, ini) + PREVIA_GRUPOS + html.slice(fim + fimMarca.length);
}

if (require.main === module) {
  const raiz = path.join(__dirname, '..');
  const pasta = path.resolve(raiz, process.argv[2] || 'publicar');
  const arquivo = path.join(pasta, 'index.html');
  fs.writeFileSync(arquivo, trocarPrevia(fs.readFileSync(arquivo, 'utf8')));
  fs.copyFileSync(path.join(raiz, 'og-grupos.jpg'), path.join(pasta, 'og-grupos.jpg'));
  console.log('og-grupos: prévia genérica aplicada em ' + arquivo);
}

module.exports = { trocarPrevia, PREVIA_GRUPOS };
