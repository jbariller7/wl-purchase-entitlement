// Manually authored account-summary translations. Authentication, billing and
// security workflows still require a separate full localization review.
import {mobileSelectionText} from './mobile-selection-text.js';
const source = [
  "WONDERLANG ACCOUNT", "Play anywhere. Keep your progress.", "Sign out", "YOUR ACCESS",
  "Account email", "Login methods", "Subscription", "Cloud saves", "Mobile platforms",
  "Future content", "Second mobile access", "Lifetime pass", "Permanent mobile",
  "Included", "Not included", "None", "Eligible on request", "Granted",
  "PREMIUM INCLUDED BENEFIT", "Request your second mobile access",
  "Email support for second mobile access", "Cloud save enabled",
  "Your two mobile accesses can be two Android accesses, two iOS accesses, or one of each. Contact support to arrange your included second access.",
  "Account recovery and security", "Request account deletion",
  "Continue with Google", "Continue with Apple"
];
const rows = {
  en: source,
  fr: ["COMPTE WONDERLANG","Jouez partout. Retrouvez votre progression.","Se déconnecter","VOTRE ACCÈS","Adresse e-mail du compte","Méthodes de connexion","Abonnement","Sauvegardes cloud","Plateformes mobiles","Contenu à venir","Deuxième accès mobile","Pass à vie","Accès mobile permanent","Inclus","Non inclus","Aucun","Disponible sur demande","Accordé","AVANTAGE PREMIUM INCLUS","Demandez votre deuxième accès mobile","Demander le deuxième accès mobile par e-mail","Sauvegarde cloud activée","Vos deux accès mobiles peuvent être deux accès Android, deux accès iOS ou un de chaque. Contactez l’assistance pour obtenir le deuxième accès inclus.","Récupération et sécurité du compte","Demander la suppression du compte","Continuer avec Google","Continuer avec Apple"],
  de: ["WONDERLANG-KONTO","Überall spielen. Spielfortschritt behalten.","Abmelden","DEIN ZUGANG","E-Mail-Adresse des Kontos","Anmeldemethoden","Abonnement","Cloud-Spielstände","Mobile Plattformen","Künftige Inhalte","Zweiter mobiler Zugang","Lebenslanger Pass","Dauerhafter mobiler Zugang","Enthalten","Nicht enthalten","Keines","Auf Anfrage verfügbar","Gewährt","ENTHALTENER PREMIUM-VORTEIL","Zweiten mobilen Zugang anfordern","Zweiten mobilen Zugang per E-Mail anfordern","Cloud-Speicherung aktiviert","Du kannst zwei Android-Zugänge, zwei iOS-Zugänge oder je einen Zugang erhalten. Kontaktiere den Support, um deinen enthaltenen zweiten Zugang einzurichten.","Kontowiederherstellung und Sicherheit","Kontolöschung beantragen","Mit Google fortfahren","Mit Apple fortfahren"],
  es: ["CUENTA DE WONDERLANG","Juega donde quieras. Conserva tu progreso.","Cerrar sesión","TU ACCESO","Correo de la cuenta","Métodos de inicio de sesión","Suscripción","Partidas en la nube","Plataformas móviles","Contenido futuro","Segundo acceso móvil","Pase de por vida","Acceso móvil permanente","Incluido","No incluido","Ninguna","Disponible previa solicitud","Concedido","VENTAJA PREMIUM INCLUIDA","Solicita tu segundo acceso móvil","Solicitar el segundo acceso móvil por correo","Guardado en la nube activado","Tus dos accesos móviles pueden ser dos accesos para Android, dos para iOS o uno para cada plataforma. Contacta con soporte para obtener el segundo acceso incluido.","Recuperación y seguridad de la cuenta","Solicitar la eliminación de la cuenta","Continuar con Google","Continuar con Apple"],
  "es-MX": ["CUENTA DE WONDERLANG","Juega donde quieras. Conserva tu progreso.","Cerrar sesión","TU ACCESO","Correo de la cuenta","Métodos de inicio de sesión","Suscripción","Partidas en la nube","Plataformas móviles","Contenido futuro","Segundo acceso móvil","Pase de por vida","Acceso móvil permanente","Incluido","No incluido","Ninguna","Disponible previa solicitud","Otorgado","BENEFICIO PREMIUM INCLUIDO","Solicita tu segundo acceso móvil","Solicitar el segundo acceso móvil por correo","Guardado en la nube activado","Tus dos accesos móviles pueden ser dos accesos para Android, dos para iOS o uno para cada plataforma. Contacta a soporte para obtener el segundo acceso incluido.","Recuperación y seguridad de la cuenta","Solicitar la eliminación de la cuenta","Continuar con Google","Continuar con Apple"],
  "pt-BR": ["CONTA WONDERLANG","Jogue em qualquer lugar. Mantenha seu progresso.","Sair","SEU ACESSO","E-mail da conta","Métodos de login","Assinatura","Jogos salvos na nuvem","Plataformas móveis","Conteúdo futuro","Segundo acesso móvel","Passe vitalício","Acesso móvel permanente","Incluído","Não incluído","Nenhuma","Disponível mediante solicitação","Concedido","BENEFÍCIO PREMIUM INCLUÍDO","Solicite seu segundo acesso móvel","Solicitar segundo acesso móvel por e-mail","Salvamento na nuvem ativado","Seus dois acessos móveis podem ser dois acessos Android, dois acessos iOS ou um de cada. Entre em contato com o suporte para obter o segundo acesso incluído.","Recuperação e segurança da conta","Solicitar exclusão da conta","Continuar com Google","Continuar com Apple"],
  "pt-PT": ["CONTA WONDERLANG","Joga em qualquer lugar. Mantém o teu progresso.","Terminar sessão","O TEU ACESSO","E-mail da conta","Métodos de início de sessão","Subscrição","Jogos guardados na nuvem","Plataformas móveis","Conteúdo futuro","Segundo acesso móvel","Passe vitalício","Acesso móvel permanente","Incluído","Não incluído","Nenhuma","Disponível mediante pedido","Concedido","VANTAGEM PREMIUM INCLUÍDA","Pede o teu segundo acesso móvel","Pedir segundo acesso móvel por e-mail","Gravação na nuvem ativada","Os teus dois acessos móveis podem ser dois acessos Android, dois acessos iOS ou um de cada. Contacta o apoio ao cliente para obteres o segundo acesso incluído.","Recuperação e segurança da conta","Pedir a eliminação da conta","Continuar com Google","Continuar com Apple"],
  it: ["ACCOUNT WONDERLANG","Gioca ovunque. Conserva i tuoi progressi.","Esci","IL TUO ACCESSO","E-mail dell’account","Metodi di accesso","Abbonamento","Salvataggi nel cloud","Piattaforme mobili","Contenuti futuri","Secondo accesso mobile","Pass a vita","Accesso mobile permanente","Incluso","Non incluso","Nessuno","Disponibile su richiesta","Concesso","VANTAGGIO PREMIUM INCLUSO","Richiedi il tuo secondo accesso mobile","Richiedi il secondo accesso mobile via e-mail","Salvataggio nel cloud attivato","I tuoi due accessi mobili possono essere due accessi Android, due accessi iOS oppure uno per ciascuna piattaforma. Contatta l’assistenza per ottenere il secondo accesso incluso.","Recupero e sicurezza dell’account","Richiedi l’eliminazione dell’account","Continua con Google","Continua con Apple"],
  nl: ["WONDERLANG-ACCOUNT","Speel overal. Behoud je voortgang.","Uitloggen","JOUW TOEGANG","E-mailadres van het account","Inlogmethoden","Abonnement","Cloudopslag","Mobiele platforms","Toekomstige content","Tweede mobiele toegang","Levenslange pas","Permanente mobiele toegang","Inbegrepen","Niet inbegrepen","Geen","Beschikbaar op aanvraag","Toegekend","INBEGREPEN PREMIUMVOORDEEL","Vraag je tweede mobiele toegang aan","Tweede mobiele toegang per e-mail aanvragen","Cloudopslag ingeschakeld","Je twee mobiele toegangen kunnen beide voor Android, beide voor iOS of één voor elk platform zijn. Neem contact op met de klantenservice om je inbegrepen tweede toegang te regelen.","Accountherstel en beveiliging","Accountverwijdering aanvragen","Doorgaan met Google","Doorgaan met Apple"],
  sv: ["WONDERLANG-KONTO","Spela var som helst. Behåll dina framsteg.","Logga ut","DIN ÅTKOMST","Kontots e-postadress","Inloggningsmetoder","Prenumeration","Molnsparningar","Mobilplattformar","Framtida innehåll","Andra mobilåtkomsten","Livstidspass","Permanent mobilåtkomst","Ingår","Ingår inte","Ingen","Tillgänglig på begäran","Beviljad","INGÅENDE PREMIUMFÖRMÅN","Begär din andra mobilåtkomst","Begär andra mobilåtkomsten via e-post","Molnsparning aktiverad","Dina två mobilåtkomster kan vara två Android-åtkomster, två iOS-åtkomster eller en av varje. Kontakta supporten för att ordna din inkluderade andra åtkomst.","Kontoåterställning och säkerhet","Begär radering av konto","Fortsätt med Google","Fortsätt med Apple"],
  pl: ["KONTO WONDERLANG","Graj wszędzie. Zachowaj postępy.","Wyloguj się","TWÓJ DOSTĘP","E-mail konta","Metody logowania","Subskrypcja","Zapisy w chmurze","Platformy mobilne","Przyszła zawartość","Drugi dostęp mobilny","Dostęp dożywotni","Stały dostęp mobilny","W cenie","Nie wchodzi w skład pakietu","Brak","Dostępny na prośbę","Przyznano","KORZYŚĆ W RAMACH PREMIUM","Poproś o drugi dostęp mobilny","Poproś o drugi dostęp mobilny e-mailem","Zapisywanie w chmurze włączone","Oba dostępy mobilne mogą dotyczyć Androida, iOS lub po jednym każdej platformy. Skontaktuj się z pomocą, aby otrzymać drugi dostęp w ramach pakietu.","Odzyskiwanie i bezpieczeństwo konta","Poproś o usunięcie konta","Kontynuuj z Google","Kontynuuj z Apple"],
  uk: ["ОБЛІКОВИЙ ЗАПИС WONDERLANG","Грайте будь-де. Зберігайте свій прогрес.","Вийти","ВАШ ДОСТУП","Електронна пошта облікового запису","Способи входу","Підписка","Хмарні збереження","Мобільні платформи","Майбутній вміст","Другий мобільний доступ","Довічний абонемент","Постійний мобільний доступ","Включено","Не включено","Немає","Доступний за запитом","Надано","ПЕРЕВАГА, ВКЛЮЧЕНА В PREMIUM","Запитайте другий мобільний доступ","Запитати другий мобільний доступ електронною поштою","Хмарне збереження ввімкнено","Ваші два мобільні доступи можуть бути для Android, для iOS або по одному для кожної платформи. Зверніться до служби підтримки, щоб отримати включений другий доступ.","Відновлення та безпека облікового запису","Запитати видалення облікового запису","Продовжити з Google","Продовжити з Apple"],
  ru: ["УЧЁТНАЯ ЗАПИСЬ WONDERLANG","Играйте где угодно. Сохраняйте прогресс.","Выйти","ВАШ ДОСТУП","Электронная почта учётной записи","Способы входа","Подписка","Облачные сохранения","Мобильные платформы","Будущий контент","Второй мобильный доступ","Пожизненный абонемент","Постоянный мобильный доступ","Включено","Не включено","Нет","Доступен по запросу","Предоставлен","ПРЕИМУЩЕСТВО В СОСТАВЕ PREMIUM","Запросите второй мобильный доступ","Запросить второй мобильный доступ по почте","Облачное сохранение включено","Оба мобильных доступа могут быть для Android, для iOS или по одному для каждой платформы. Обратитесь в поддержку, чтобы получить включённый второй доступ.","Восстановление и безопасность учётной записи","Запросить удаление учётной записи","Продолжить с Google","Продолжить с Apple"],
  id: ["AKUN WONDERLANG","Main di mana saja. Simpan progresmu.","Keluar","AKSESMU","Email akun","Metode masuk","Langganan","Simpanan cloud","Platform seluler","Konten mendatang","Akses seluler kedua","Pas seumur hidup","Akses seluler permanen","Termasuk","Tidak termasuk","Tidak ada","Tersedia atas permintaan","Diberikan","MANFAAT PREMIUM YANG TERMASUK","Minta akses seluler keduamu","Minta akses seluler kedua lewat email","Penyimpanan cloud aktif","Kedua akses selulermu bisa berupa dua akses Android, dua akses iOS, atau satu untuk masing-masing platform. Hubungi dukungan untuk mendapatkan akses kedua yang termasuk dalam paket.","Pemulihan dan keamanan akun","Minta penghapusan akun","Lanjutkan dengan Google","Lanjutkan dengan Apple"],
  ko: ["WONDERLANG 계정","어디서든 플레이하고 진행 상황을 이어가세요.","로그아웃","이용 권한","계정 이메일","로그인 방법","구독","클라우드 저장","모바일 플랫폼","향후 콘텐츠","두 번째 모바일 이용권","평생 이용권","모바일 영구 이용권","포함","미포함","없음","요청 시 제공","지급 완료","PREMIUM 포함 혜택","두 번째 모바일 이용권 요청","이메일로 두 번째 모바일 이용권 요청","클라우드 저장 활성화됨","모바일 이용권 두 개를 모두 Android용 또는 iOS용으로 받거나, 각 플랫폼용으로 하나씩 받을 수 있습니다. 포함된 두 번째 이용권을 받으려면 고객 지원에 문의하세요.","계정 복구 및 보안","계정 삭제 요청","Google로 계속하기","Apple로 계속하기"],
  ja: ["WONDERLANGアカウント","どこでもプレイ。続きから楽しもう。","ログアウト","利用権","アカウントのメールアドレス","ログイン方法","サブスクリプション","クラウドセーブ","モバイルプラットフォーム","今後のコンテンツ","2つ目のモバイル利用権","生涯パス","モバイル永久利用権","含まれます","含まれません","なし","リクエストで利用可能","付与済み","PREMIUMに含まれる特典","2つ目のモバイル利用権をリクエスト","メールで2つ目のモバイル利用権をリクエスト","クラウドセーブ有効","2つのモバイル利用権は、両方Android用、両方iOS用、または各プラットフォーム用を1つずつ選べます。特典の2つ目の利用権についてはサポートにお問い合わせください。","アカウントの復旧とセキュリティ","アカウントの削除をリクエスト","Googleで続行","Appleで続行"],
  "zh-CN": ["WONDERLANG 账户","随处畅玩，保留进度。","退出登录","你的访问权限","账户邮箱","登录方式","订阅","云存档","移动平台","未来内容","第二份移动版访问权限","终身通行证","移动版永久访问权限","已包含","未包含","无","可申请","已授予","PREMIUM 内含权益","申请第二份移动版访问权限","通过邮件申请第二份移动版访问权限","云存档已启用","两份移动版访问权限可以都用于 Android、都用于 iOS，或每个平台各一份。请联系客服领取套餐内包含的第二份权限。","账户恢复与安全","申请删除账户","使用 Google 继续","使用 Apple 继续"],
  "zh-TW": ["WONDERLANG 帳戶","隨處暢玩，保留進度。","登出","你的存取權限","帳戶電子郵件","登入方式","訂閱","雲端存檔","行動平台","未來內容","第二份行動版存取權限","終身通行證","行動版永久存取權限","已包含","未包含","無","可申請","已授予","PREMIUM 內含權益","申請第二份行動版存取權限","透過電子郵件申請第二份行動版存取權限","雲端存檔已啟用","兩份行動版存取權限可以都用於 Android、都用於 iOS，或每個平台各一份。請聯絡客服領取方案內包含的第二份權限。","帳戶復原與安全","申請刪除帳戶","使用 Google 繼續","使用 Apple 繼續"],
  ar: ["حساب WONDERLANG","العب في أي مكان واحتفظ بتقدمك.","تسجيل الخروج","صلاحية الوصول","البريد الإلكتروني للحساب","طرق تسجيل الدخول","الاشتراك","ملفات الحفظ السحابية","منصات الجوال","المحتوى المستقبلي","صلاحية الجوال الثانية","تصريح مدى الحياة","وصول دائم على الجوال","مشمول","غير مشمول","لا يوجد","متاح عند الطلب","تم المنح","ميزة مشمولة في PREMIUM","اطلب صلاحية الجوال الثانية","طلب صلاحية الجوال الثانية عبر البريد","الحفظ السحابي مفعّل","يمكن أن تكون صلاحيتا الجوال كلتاهما لنظام Android أو كلتاهما لنظام iOS أو واحدة لكل نظام. تواصل مع الدعم للحصول على الصلاحية الثانية المشمولة.","استرداد الحساب وأمانه","طلب حذف الحساب","المتابعة باستخدام Google","المتابعة باستخدام Apple"],
  hy: ["WONDERLANG ՀԱՇԻՎ","Խաղացեք ամենուր՝ պահպանելով ձեր առաջընթացը։","Դուրս գալ","ՁԵՐ ՀԱՍԱՆԵԼԻՈՒԹՅՈՒՆԸ","Հաշվի էլեկտրոնային փոստ","Մուտքի եղանակներ","Բաժանորդագրություն","Ամպային պահպանումներ","Բջջային հարթակներ","Ապագա բովանդակություն","Երկրորդ բջջային հասանելիություն","Ցմահ անցագիր","Մշտական բջջային հասանելիություն","Ներառված է","Ներառված չէ","Չկա","Հասանելի է ըստ խնդրանքի","Տրամադրված է","PREMIUM-ՈՒՄ ՆԵՐԱՌՎԱԾ ԱՌԱՎԵԼՈՒԹՅՈՒՆ","Խնդրեք երկրորդ բջջային հասանելիությունը","Էլեկտրոնային փոստով խնդրել երկրորդ բջջային հասանելիությունը","Ամպային պահպանումը միացված է","Ձեր երկու բջջային հասանելիությունները կարող են լինել երկուսն էլ Android-ի համար, երկուսն էլ iOS-ի համար կամ յուրաքանչյուրից մեկը։ Կապվեք աջակցության հետ՝ ներառված երկրորդ հասանելիությունը ստանալու համար։","Հաշվի վերականգնում և անվտանգություն","Խնդրել հաշվի ջնջումը","Շարունակել Google-ով","Շարունակել Apple-ով"]
};
export const languages = [
  ["en","English"],["fr","Français"],["de","Deutsch"],["es","Español"],["es-MX","Español (Latinoamérica)"],
  ["pt-BR","Português (Brasil)"],["pt-PT","Português (Portugal)"],["it","Italiano"],["nl","Nederlands"],["sv","Svenska"],
  ["pl","Polski"],["uk","Українська"],["ru","Русский"],["id","Bahasa Indonesia"],["ko","한국어"],["ja","日本語"],
  ["zh-CN","简体中文"],["zh-TW","繁體中文"],["ar","العربية"],["hy","Հայերեն"]
];
export const dictionaries = Object.fromEntries(Object.entries(rows).map(([locale, values]) => {
  if (values.length !== source.length) throw new Error("Account translation length mismatch: " + locale);
  return [locale, Object.fromEntries(source.map((key, index) => [key, values[index]]))];
}));
const profileSource = ["Save profiles","Refresh profiles","Last cloud sync","Not synced yet","Save","Saved in game","Play time","Autosave","Unavailable","No saved games in this profile yet","No profiles yet","Loading profiles…","Loading saves…","These are your cloud backups, not the saves currently on this device. Sync from the game to update them."];
const profileRows = {
  en: profileSource,
  fr: ["Profils de sauvegarde","Actualiser les profils","Dernière synchronisation cloud","Pas encore synchronisé","Sauvegarde","Enregistrée dans le jeu","Temps de jeu","Sauvegarde automatique","Indisponible","Aucune partie sauvegardée dans ce profil pour le moment","Aucun profil pour le moment","Chargement des profils…","Chargement des sauvegardes…","Ce sont vos sauvegardes cloud, pas les sauvegardes présentes sur cet appareil. Synchronisez depuis le jeu pour les mettre à jour."],
  de: ["Spielstandprofile","Profile aktualisieren","Letzte Cloud-Synchronisierung","Noch nicht synchronisiert","Spielstand","Im Spiel gespeichert","Spielzeit","Automatischer Spielstand","Nicht verfügbar","Noch keine Spielstände in diesem Profil","Noch keine Profile","Profile werden geladen…","Spielstände werden geladen…","Dies sind deine Cloud-Sicherungen, nicht die Spielstände auf diesem Gerät. Synchronisiere im Spiel, um sie zu aktualisieren."],
  es: ["Perfiles de guardado","Actualizar perfiles","Última sincronización en la nube","Aún sin sincronizar","Partida","Guardada en el juego","Tiempo de juego","Guardado automático","No disponible","Aún no hay partidas guardadas en este perfil","Aún no hay perfiles","Cargando perfiles…","Cargando partidas…","Estas son tus copias en la nube, no las partidas que hay actualmente en este dispositivo. Sincroniza desde el juego para actualizarlas."],
  "es-MX": ["Perfiles de guardado","Actualizar perfiles","Última sincronización en la nube","Aún sin sincronizar","Partida","Guardada en el juego","Tiempo de juego","Guardado automático","No disponible","Aún no hay partidas guardadas en este perfil","Aún no hay perfiles","Cargando perfiles…","Cargando partidas…","Estas son tus copias en la nube, no las partidas que hay actualmente en este dispositivo. Sincroniza desde el juego para actualizarlas."],
  "pt-BR": ["Perfis de salvamento","Atualizar perfis","Última sincronização na nuvem","Ainda não sincronizado","Jogo salvo","Salvo no jogo","Tempo de jogo","Salvamento automático","Indisponível","Ainda não há jogos salvos neste perfil","Ainda não há perfis","Carregando perfis…","Carregando jogos salvos…","Estes são seus backups na nuvem, não os jogos salvos atualmente neste dispositivo. Sincronize pelo jogo para atualizá-los."],
  "pt-PT": ["Perfis de gravação","Atualizar perfis","Última sincronização na nuvem","Ainda não sincronizado","Jogo guardado","Guardado no jogo","Tempo de jogo","Gravação automática","Indisponível","Ainda não há jogos guardados neste perfil","Ainda não há perfis","A carregar perfis…","A carregar jogos guardados…","Estas são as tuas cópias na nuvem, não os jogos guardados atualmente neste dispositivo. Sincroniza a partir do jogo para as atualizares."],
  it: ["Profili di salvataggio","Aggiorna profili","Ultima sincronizzazione cloud","Non ancora sincronizzato","Salvataggio","Salvato nel gioco","Tempo di gioco","Salvataggio automatico","Non disponibile","Nessuna partita salvata in questo profilo","Nessun profilo","Caricamento profili…","Caricamento salvataggi…","Questi sono i tuoi backup nel cloud, non i salvataggi presenti su questo dispositivo. Sincronizza dal gioco per aggiornarli."],
  nl: ["Opslagprofielen","Profielen vernieuwen","Laatste cloudsynchronisatie","Nog niet gesynchroniseerd","Opgeslagen spel","In het spel opgeslagen","Speeltijd","Automatisch opgeslagen spel","Niet beschikbaar","Nog geen opgeslagen spellen in dit profiel","Nog geen profielen","Profielen laden…","Opgeslagen spellen laden…","Dit zijn je cloudback-ups, niet de opgeslagen spellen op dit apparaat. Synchroniseer vanuit het spel om ze bij te werken."],
  sv: ["Sparprofiler","Uppdatera profiler","Senaste molnsynkronisering","Inte synkroniserad ännu","Sparfil","Sparad i spelet","Speltid","Autosparning","Inte tillgängligt","Inga sparade spel i den här profilen ännu","Inga profiler ännu","Läser in profiler…","Läser in sparade spel…","Det här är dina molnkopior, inte de sparade spelen på den här enheten. Synkronisera från spelet för att uppdatera dem."],
  pl: ["Profile zapisów","Odśwież profile","Ostatnia synchronizacja z chmurą","Jeszcze nie zsynchronizowano","Zapis","Zapisano w grze","Czas gry","Autozapis","Niedostępne","W tym profilu nie ma jeszcze zapisanych gier","Nie ma jeszcze profili","Wczytywanie profili…","Wczytywanie zapisów…","To kopie zapasowe w chmurze, a nie zapisy znajdujące się obecnie na tym urządzeniu. Zsynchronizuj je w grze, aby je zaktualizować."],
  uk: ["Профілі збережень","Оновити профілі","Остання синхронізація з хмарою","Ще не синхронізовано","Збереження","Збережено в грі","Час гри","Автозбереження","Недоступно","У цьому профілі ще немає збережених ігор","Профілів ще немає","Завантаження профілів…","Завантаження збережень…","Це ваші хмарні резервні копії, а не збереження на цьому пристрої. Виконайте синхронізацію в грі, щоб оновити їх."],
  ru: ["Профили сохранений","Обновить профили","Последняя синхронизация с облаком","Ещё не синхронизировано","Сохранение","Сохранено в игре","Время игры","Автосохранение","Недоступно","В этом профиле ещё нет сохранённых игр","Профилей пока нет","Загрузка профилей…","Загрузка сохранений…","Это ваши облачные резервные копии, а не сохранения на этом устройстве. Выполните синхронизацию в игре, чтобы обновить их."],
  id: ["Profil simpanan","Muat ulang profil","Sinkronisasi cloud terakhir","Belum disinkronkan","Simpanan","Disimpan dalam game","Waktu bermain","Simpanan otomatis","Tidak tersedia","Belum ada game tersimpan di profil ini","Belum ada profil","Memuat profil…","Memuat simpanan…","Ini adalah cadangan cloud-mu, bukan simpanan yang saat ini ada di perangkat ini. Sinkronkan dari dalam game untuk memperbaruinya."],
  ko: ["저장 프로필","프로필 새로고침","마지막 클라우드 동기화","아직 동기화되지 않음","저장","게임 내 저장 시각","플레이 시간","자동 저장","정보 없음","이 프로필에는 아직 저장된 게임이 없습니다","아직 프로필이 없습니다","프로필 불러오는 중…","저장 데이터 불러오는 중…","이 목록은 현재 기기의 저장 데이터가 아니라 클라우드 백업입니다. 업데이트하려면 게임에서 동기화하세요."],
  ja: ["セーブプロフィール","プロフィールを更新","最終クラウド同期","まだ同期されていません","セーブ","ゲーム内の保存日時","プレイ時間","オートセーブ","情報なし","このプロフィールにはまだセーブがありません","まだプロフィールがありません","プロフィールを読み込み中…","セーブを読み込み中…","これはクラウドのバックアップで、この端末にあるセーブではありません。更新するにはゲーム内で同期してください。"],
  "zh-CN": ["存档档案","刷新档案","上次云同步","尚未同步","存档","游戏内保存时间","游玩时间","自动存档","暂无信息","此档案尚无游戏存档","尚无档案","正在加载档案…","正在加载存档…","这些是云备份，不是当前设备上的存档。请在游戏中同步以更新备份。"],
  "zh-TW": ["存檔設定檔","重新整理設定檔","上次雲端同步","尚未同步","存檔","遊戲內儲存時間","遊玩時間","自動存檔","暫無資訊","此設定檔尚無遊戲存檔","尚無設定檔","正在載入設定檔…","正在載入存檔…","這些是雲端備份，不是目前裝置上的存檔。請在遊戲中同步以更新備份。"],
  ar: ["ملفات تعريف الحفظ","تحديث ملفات التعريف","آخر مزامنة سحابية","لم تتم المزامنة بعد","حفظ","وقت الحفظ داخل اللعبة","وقت اللعب","حفظ تلقائي","غير متاح","لا توجد ألعاب محفوظة في هذا الملف بعد","لا توجد ملفات تعريف بعد","جارٍ تحميل ملفات التعريف…","جارٍ تحميل ملفات الحفظ…","هذه نسخك الاحتياطية السحابية، وليست ملفات الحفظ الموجودة حاليًا على هذا الجهاز. قم بالمزامنة من داخل اللعبة لتحديثها."],
  hy: ["Պահպանման պրոֆիլներ","Թարմացնել պրոֆիլները","Վերջին ամպային համաժամացումը","Դեռ համաժամացված չէ","Պահպանում","Պահպանվել է խաղում","Խաղաժամանակ","Ավտոմատ պահպանում","Տվյալ չկա","Այս պրոֆիլում դեռ պահպանված խաղեր չկան","Դեռ պրոֆիլներ չկան","Պրոֆիլները բեռնվում են…","Պահպանումները բեռնվում են…","Սրանք ձեր ամպային պահուստային պատճեններն են, ոչ թե այս սարքի ընթացիկ պահպանումները։ Դրանք թարմացնելու համար համաժամացրեք խաղի միջից։"]
};
for (const [locale, values] of Object.entries(profileRows)) {
  if (values.length !== profileSource.length) throw new Error("Profile translation length mismatch: " + locale);
  profileSource.forEach((key, index) => { dictionaries[locale][key] = values[index]; });
}
const signInSource = ["Sign-in methods","Add another way to sign in to this same account. Your purchases, profiles and saves stay together.","Connected","Add Google sign-in","Add Apple sign-in","Add email sign-in","Email"];
const signInRows = {
  en: signInSource,
  fr: ["Méthodes de connexion","Ajoutez une autre façon de vous connecter à ce même compte. Vos achats, profils et sauvegardes restent regroupés.","Associé","Ajouter la connexion Google","Ajouter la connexion Apple","Ajouter la connexion par e-mail","E-mail"],
  de: ["Anmeldemethoden","Füge eine weitere Anmeldemöglichkeit für dasselbe Konto hinzu. Deine Käufe, Profile und Spielstände bleiben zusammen.","Verknüpft","Google-Anmeldung hinzufügen","Apple-Anmeldung hinzufügen","E-Mail-Anmeldung hinzufügen","E-Mail"],
  es: ["Métodos de inicio de sesión","Añade otra forma de iniciar sesión en esta misma cuenta. Tus compras, perfiles y partidas guardadas permanecen juntos.","Vinculado","Añadir inicio de sesión con Google","Añadir inicio de sesión con Apple","Añadir inicio de sesión por correo","Correo electrónico"],
  "es-MX": ["Métodos de inicio de sesión","Agrega otra forma de iniciar sesión en esta misma cuenta. Tus compras, perfiles y partidas guardadas permanecen juntos.","Vinculado","Agregar inicio de sesión con Google","Agregar inicio de sesión con Apple","Agregar inicio de sesión por correo","Correo electrónico"],
  "pt-BR": ["Métodos de login","Adicione outra forma de entrar nesta mesma conta. Suas compras, perfis e jogos salvos continuam juntos.","Vinculado","Adicionar login com Google","Adicionar login com Apple","Adicionar login por e-mail","E-mail"],
  "pt-PT": ["Métodos de início de sessão","Adiciona outra forma de entrar nesta mesma conta. As tuas compras, perfis e jogos guardados continuam juntos.","Associado","Adicionar início de sessão com Google","Adicionar início de sessão com Apple","Adicionar início de sessão por e-mail","E-mail"],
  it: ["Metodi di accesso","Aggiungi un altro modo per accedere a questo stesso account. Acquisti, profili e salvataggi rimangono insieme.","Collegato","Aggiungi accesso con Google","Aggiungi accesso con Apple","Aggiungi accesso tramite e-mail","E-mail"],
  nl: ["Inlogmethoden","Voeg een andere manier toe om in te loggen op hetzelfde account. Je aankopen, profielen en opgeslagen spellen blijven bij elkaar.","Gekoppeld","Inloggen met Google toevoegen","Inloggen met Apple toevoegen","Inloggen via e-mail toevoegen","E-mail"],
  sv: ["Inloggningsmetoder","Lägg till ett annat sätt att logga in på samma konto. Dina köp, profiler och sparade spel hålls samlade.","Länkat","Lägg till Google-inloggning","Lägg till Apple-inloggning","Lägg till e-postinloggning","E-post"],
  pl: ["Metody logowania","Dodaj inny sposób logowania do tego samego konta. Twoje zakupy, profile i zapisy pozostaną razem.","Połączono","Dodaj logowanie przez Google","Dodaj logowanie przez Apple","Dodaj logowanie e-mailem","E-mail"],
  uk: ["Способи входу","Додайте інший спосіб входу до цього самого облікового запису. Ваші покупки, профілі та збереження залишаться разом.","Пов’язано","Додати вхід через Google","Додати вхід через Apple","Додати вхід електронною поштою","Електронна пошта"],
  ru: ["Способы входа","Добавьте другой способ входа в эту же учётную запись. Ваши покупки, профили и сохранения останутся вместе.","Привязано","Добавить вход через Google","Добавить вход через Apple","Добавить вход по электронной почте","Электронная почта"],
  id: ["Metode masuk","Tambahkan cara lain untuk masuk ke akun yang sama ini. Pembelian, profil, dan simpananmu tetap bersama.","Terhubung","Tambahkan masuk dengan Google","Tambahkan masuk dengan Apple","Tambahkan masuk lewat email","Email"],
  ko: ["로그인 방법","같은 계정에 로그인하는 다른 방법을 추가하세요. 구매 내역, 프로필, 저장 데이터는 그대로 유지됩니다.","연결됨","Google 로그인 추가","Apple 로그인 추가","이메일 로그인 추가","이메일"],
  ja: ["ログイン方法","この同じアカウントにログインする別の方法を追加できます。購入内容、プロフィール、セーブはそのまま引き継がれます。","連携済み","Googleログインを追加","Appleログインを追加","メールでのログインを追加","メール"],
  "zh-CN": ["登录方式","为同一个账户添加其他登录方式。你的购买内容、档案和存档仍保留在一起。","已关联","添加 Google 登录","添加 Apple 登录","添加邮箱登录","电子邮箱"],
  "zh-TW": ["登入方式","為同一個帳戶新增其他登入方式。你的購買內容、設定檔和存檔仍保留在一起。","已連結","新增 Google 登入","新增 Apple 登入","新增電子郵件登入","電子郵件"],
  ar: ["طرق تسجيل الدخول","أضف طريقة أخرى لتسجيل الدخول إلى الحساب نفسه. ستبقى مشترياتك وملفات تعريفك وملفات حفظك معًا.","مرتبط","إضافة تسجيل الدخول عبر Google","إضافة تسجيل الدخول عبر Apple","إضافة تسجيل الدخول بالبريد الإلكتروني","البريد الإلكتروني"],
  hy: ["Մուտքի եղանակներ","Ավելացրեք նույն հաշիվ մուտք գործելու մեկ այլ եղանակ։ Ձեր գնումները, պրոֆիլներն ու պահպանումները կմնան միասին։","Կապակցված է","Ավելացնել մուտք Google-ով","Ավելացնել մուտք Apple-ով","Ավելացնել մուտք էլեկտրոնային փոստով","Էլեկտրոնային փոստ"]
};
for (const [locale, values] of Object.entries(signInRows)) {
  if (values.length !== signInSource.length) throw new Error("Sign-in translation length mismatch: " + locale);
  signInSource.forEach((key, index) => { dictionaries[locale][key] = values[index]; });
}
const premiumCloudRequirement = {
  "en": "Cloud save requires a Premium Lifetime Pass.",
  "fr": "Les sauvegardes cloud nécessitent un Premium Lifetime Pass.",
  "es": "El guardado en la nube requiere un Premium Lifetime Pass.",
  "es-MX": "El guardado en la nube requiere un Premium Lifetime Pass.",
  "de": "Cloud-Spielstände erfordern einen Premium Lifetime Pass.",
  "pt-BR": "Os salvamentos na nuvem exigem um Premium Lifetime Pass.",
  "pt-PT": "Os ficheiros guardados na nuvem requerem um Premium Lifetime Pass.",
  "it": "I salvataggi nel cloud richiedono un Premium Lifetime Pass.",
  "nl": "Cloudopslag vereist een Premium Lifetime Pass.",
  "sv": "Molnsparningar kräver ett Premium Lifetime Pass.",
  "ru": "Для облачных сохранений нужен Premium Lifetime Pass.",
  "uk": "Для хмарних збережень потрібен Premium Lifetime Pass.",
  "pl": "Zapisy w chmurze wymagają Premium Lifetime Pass.",
  "id": "Penyimpanan cloud memerlukan Premium Lifetime Pass.",
  "ko": "클라우드 저장을 이용하려면 Premium Lifetime Pass가 필요합니다.",
  "ja": "クラウドセーブにはPremium Lifetime Passが必要です。",
  "zh-CN": "云存档需要 Premium Lifetime Pass。",
  "zh-TW": "雲端存檔需要 Premium Lifetime Pass。",
  "ar": "الحفظ السحابي يتطلب Premium Lifetime Pass.",
  "hy": "Ամպային պահպանման համար անհրաժեշտ է Premium Lifetime Pass։"
};
for (const [locale, value] of Object.entries(premiumCloudRequirement)) {
  if (dictionaries[locale]) dictionaries[locale]["Cloud save requires a Premium Lifetime Pass."] = value;
}
export function translateSummary(value, language) {
  const mobileIndex=mobileSelectionText.en.indexOf(value);
  if(mobileIndex>=0)return (mobileSelectionText[language]??mobileSelectionText.en)[mobileIndex];
  return dictionaries[language]?.[value] ?? value;
}
export function installAccountLanguagePicker(root) {
  let saved;
  try { saved = localStorage.getItem("wonderlang-account-language"); } catch {}
  let locale = dictionaries[saved] ? saved : "en";
  const control = document.createElement("label");
  control.className = "wl-language";
  control.innerHTML = '<span>🌐</span><select aria-label="Language">' + languages.map(([code, label]) => '<option value="' + code + '">' + label + '</option>').join("") + "</select>";
  root.querySelector(".wl-header").append(control);
  const select = control.querySelector("select");
  select.value = locale;
  const originals = new WeakMap();
  const observer = new MutationObserver(apply);
  function apply() {
    observer.disconnect();
    root.lang = locale;
    root.dir = locale === "ar" ? "rtl" : "ltr";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest("select,script,style,input,[data-user-content],[data-field=email],[data-field=providers],.wl-status")) continue;
      const previous = originals.get(node);
      const original = previous && node.nodeValue === previous.translated ? previous.original : node.nodeValue;
      const trimmed = original.trim();
      const translated = original.replace(trimmed, translateSummary(trimmed, locale));
      if (translated !== node.nodeValue) node.nodeValue = translated;
      originals.set(node, {original, translated});
    }
    observer.observe(root, {subtree: true, childList: true, characterData: true});
  }
  select.addEventListener("change", () => {
    locale = select.value;
    try { localStorage.setItem("wonderlang-account-language", locale); } catch {}
    apply();
  });
  apply();
  return () => observer.disconnect();
}
