import type {EmailLocale} from './copy.js';

export const freePdfLinks = {
 primary: 'https://1drv.ms/f/s!AqZmj-f73KVsraARXTcIJ_26JcaW5w?e=QwYE3L',
 mirror: 'https://www.dropbox.com/scl/fo/cgveqqcfeutnnejryo3ww/AJawlvnE4Uecf6zyY3RTtmw?rlkey=phu91y5qzyomm3ew8sutptfu5&st=yox61rn8&dl=0'
} as const;

// Manually authored: section heading, primary download button, mirror button.
export const pdfCopy = {
 en: ['Free PDF content', 'Download PDFs (OneDrive)', 'Alternative link (Dropbox)'],
 fr: ['Contenu PDF gratuit', 'Télécharger les PDF (OneDrive)', 'Lien alternatif (Dropbox)'],
 de: ['Kostenlose PDF-Inhalte', 'PDFs herunterladen (OneDrive)', 'Alternativer Link (Dropbox)'],
 es: ['Contenido PDF gratuito', 'Descargar los PDF (OneDrive)', 'Enlace alternativo (Dropbox)'],
 'es-MX': ['Contenido PDF gratuito', 'Descargar los PDF (OneDrive)', 'Enlace alternativo (Dropbox)'],
 'pt-BR': ['Conteúdo gratuito em PDF', 'Baixar os PDFs (OneDrive)', 'Link alternativo (Dropbox)'],
 'pt-PT': ['Conteúdo gratuito em PDF', 'Transferir os PDF (OneDrive)', 'Ligação alternativa (Dropbox)'],
 it: ['Contenuti PDF gratuiti', 'Scarica i PDF (OneDrive)', 'Link alternativo (Dropbox)'],
 nl: ['Gratis PDF-materiaal', 'PDF’s downloaden (OneDrive)', 'Alternatieve link (Dropbox)'],
 sv: ['Gratis PDF-material', 'Ladda ner PDF-filer (OneDrive)', 'Alternativ länk (Dropbox)'],
 pl: ['Bezpłatne materiały PDF', 'Pobierz pliki PDF (OneDrive)', 'Alternatywny link (Dropbox)'],
 uk: ['Безкоштовні матеріали у форматі PDF', 'Завантажити PDF (OneDrive)', 'Альтернативне посилання (Dropbox)'],
 ru: ['Бесплатные материалы в формате PDF', 'Скачать PDF (OneDrive)', 'Альтернативная ссылка (Dropbox)'],
 id: ['Konten PDF gratis', 'Unduh PDF (OneDrive)', 'Tautan alternatif (Dropbox)'],
 ko: ['무료 PDF 자료', 'PDF 다운로드 (OneDrive)', '대체 링크 (Dropbox)'],
 ja: ['無料PDF教材', 'PDFをダウンロード（OneDrive）', '代替リンク（Dropbox）'],
 'zh-CN': ['免费 PDF 资料', '下载 PDF（OneDrive）', '备用链接（Dropbox）'],
 'zh-TW': ['免費 PDF 資料', '下載 PDF（OneDrive）', '備用連結（Dropbox）'],
 ar: ['محتوى PDF مجاني', 'تنزيل ملفات PDF (OneDrive)', 'رابط بديل (Dropbox)'],
 hy: ['Անվճար PDF նյութեր', 'Ներբեռնել PDF ֆայլերը (OneDrive)', 'Այլընտրանքային հղում (Dropbox)']
} as const satisfies Record<EmailLocale, readonly [string, string, string]>;
