/**
 * The two sentences the app itself speaks, in each language calls can be in (keyed by the
 * language subtag; "zh-Hant" for Traditional Chinese): `preview` for 设置 → 语音 → 试听, `degraded`
 * when a call has no brief and the raw report is on screen. Every language of `AZURE_LANGUAGES`
 * has an entry (checked by a test).
 */
export const PHRASES: Record<string, { preview: string; degraded: string }> = {
  af: {
    preview:
      "Hallo, ek is OutBrief. Wanneer 'n agent 'n taak klaarmaak, bel ek jou met hierdie stem om verslag te doen.",
    degraded: "Ek kon nie 'n opsomming maak nie, so die volledige verslag is op jou skerm.",
  },
  am: {
    preview: "ሰላም፣ እኔ OutBrief ነኝ። አንድ ኤጀንት ሥራውን ሲጨርስ በዚህ ድምፅ ደውዬ ሪፖርት አደርግልሃለሁ።",
    degraded: "ማጠቃለያ ማዘጋጀት አልቻልኩም፣ ስለዚህ ሙሉው ሪፖርት በስክሪንህ ላይ ነው።",
  },
  ar: {
    preview: "مرحبًا، أنا OutBrief. عندما ينهي أحد الوكلاء مهمة، سأتصل بك بهذا الصوت لأبلغك.",
    degraded: "لم أتمكن من إعداد الملخص، لذلك التقرير الكامل معروض على شاشتك.",
  },
  az: {
    preview:
      "Salam, mən OutBrief-əm. Agent tapşırığı bitirəndə sizə bu səslə zəng edib hesabat verəcəyəm.",
    degraded: "Xülasə hazırlaya bilmədim, ona görə tam hesabat ekranınızdadır.",
  },
  bg: {
    preview:
      "Здравейте, аз съм OutBrief. Когато агент приключи задача, ще ви се обадя с този глас, за да докладвам.",
    degraded: "Не успях да подготвя резюме, затова пълният доклад е на екрана ви.",
  },
  bn: {
    preview: "নমস্কার, আমি OutBrief। কোনো এজেন্ট কাজ শেষ করলে আমি এই কণ্ঠে আপনাকে ফোন করে জানাব।",
    degraded: "সারসংক্ষেপ তৈরি করতে পারিনি, তাই পুরো রিপোর্টটি আপনার স্ক্রিনে আছে।",
  },
  bs: {
    preview:
      "Zdravo, ja sam OutBrief. Kada agent završi zadatak, nazvat ću vas ovim glasom da vas obavijestim.",
    degraded: "Nisam uspio pripremiti sažetak, pa je cijeli izvještaj na vašem ekranu.",
  },
  ca: {
    preview:
      "Hola, sóc OutBrief. Quan un agent acabi una tasca, et trucaré amb aquesta veu per informar-te'n.",
    degraded: "No he pogut preparar el resum, així que l'informe complet és a la teva pantalla.",
  },
  cs: {
    preview:
      "Dobrý den, jsem OutBrief. Až agent dokončí úkol, zavolám vám tímto hlasem a podám zprávu.",
    degraded: "Nepodařilo se mi připravit shrnutí, takže celá zpráva je na vaší obrazovce.",
  },
  cy: {
    preview:
      "Helo, OutBrief ydw i. Pan fydd asiant yn gorffen tasg, bydda i'n eich ffonio gyda'r llais hwn i adrodd.",
    degraded: "Methais baratoi crynodeb, felly mae'r adroddiad llawn ar eich sgrin.",
  },
  da: {
    preview:
      "Hej, jeg er OutBrief. Når en agent er færdig med en opgave, ringer jeg til dig med denne stemme og giver besked.",
    degraded: "Jeg kunne ikke lave et resumé, så hele rapporten står på din skærm.",
  },
  de: {
    preview:
      "Hallo, ich bin OutBrief. Wenn ein Agent eine Aufgabe erledigt hat, rufe ich dich mit dieser Stimme an und berichte.",
    degraded:
      "Ich konnte keine Zusammenfassung erstellen, der vollständige Bericht steht auf deinem Bildschirm.",
  },
  el: {
    preview:
      "Γεια σας, είμαι το OutBrief. Όταν ένας πράκτορας ολοκληρώνει μια εργασία, θα σας καλώ με αυτή τη φωνή για να σας ενημερώσω.",
    degraded: "Δεν μπόρεσα να ετοιμάσω περίληψη, οπότε η πλήρης αναφορά είναι στην οθόνη σας.",
  },
  en: {
    preview:
      "Hi, I'm OutBrief. When an agent finishes a task, I'll call you in this voice to report.",
    degraded: "I couldn't prepare a brief, so the full report is on your screen.",
  },
  es: {
    preview:
      "Hola, soy OutBrief. Cuando un agente termine una tarea, te llamaré con esta voz para contártelo.",
    degraded: "No pude preparar el resumen, así que el informe completo está en tu pantalla.",
  },
  et: {
    preview:
      "Tere, mina olen OutBrief. Kui agent ülesande lõpetab, helistan teile selle häälega ja annan aru.",
    degraded: "Ma ei saanud kokkuvõtet koostada, nii et kogu aruanne on teie ekraanil.",
  },
  fa: {
    preview:
      "سلام، من OutBrief هستم. وقتی یک عامل کارش را تمام کند، با این صدا به شما زنگ می‌زنم و گزارش می‌دهم.",
    degraded: "نتوانستم خلاصه را آماده کنم، برای همین گزارش کامل روی صفحهٔ شماست.",
  },
  fi: {
    preview:
      "Hei, olen OutBrief. Kun agentti saa tehtävän valmiiksi, soitan sinulle tällä äänellä ja kerron siitä.",
    degraded: "En saanut tehtyä yhteenvetoa, joten koko raportti on näytölläsi.",
  },
  fil: {
    preview:
      "Kumusta, ako si OutBrief. Kapag natapos ng isang agent ang gawain, tatawagan kita gamit ang boses na ito para mag-ulat.",
    degraded: "Hindi ako nakagawa ng buod, kaya nasa screen mo ang buong ulat.",
  },
  fr: {
    preview:
      "Bonjour, je suis OutBrief. Quand un agent aura fini une tâche, je vous appellerai avec cette voix pour vous en rendre compte.",
    degraded: "Je n'ai pas pu préparer le résumé, le rapport complet est affiché à l'écran.",
  },
  ga: {
    preview:
      "Dia duit, is mise OutBrief. Nuair a chríochnaíonn gníomhaire tasc, glaofaidh mé ort leis an nguth seo le tuairisc a thabhairt.",
    degraded:
      "Níorbh fhéidir liom achoimre a ullmhú, mar sin tá an tuairisc iomlán ar do scáileán.",
  },
  gl: {
    preview:
      "Ola, son OutBrief. Cando un axente remate unha tarefa, chamareite con esta voz para contarcho.",
    degraded: "Non puiden preparar o resumo, así que o informe completo está na túa pantalla.",
  },
  he: {
    preview: "שלום, אני OutBrief. כשסוכן מסיים משימה, אתקשר אליך בקול הזה כדי לדווח.",
    degraded: "לא הצלחתי להכין סיכום, אז הדוח המלא מוצג על המסך שלך.",
  },
  hi: {
    preview: "नमस्ते, मैं OutBrief हूँ। जब कोई एजेंट काम पूरा करेगा, मैं इसी आवाज़ में आपको फ़ोन करके बताऊँगी।",
    degraded: "मैं सारांश तैयार नहीं कर पाई, इसलिए पूरी रिपोर्ट आपकी स्क्रीन पर है।",
  },
  hr: {
    preview:
      "Bok, ja sam OutBrief. Kad agent završi zadatak, nazvat ću vas ovim glasom i izvijestiti vas.",
    degraded: "Nisam uspio pripremiti sažetak, pa je cijelo izvješće na vašem zaslonu.",
  },
  hu: {
    preview:
      "Szia, OutBrief vagyok. Amikor egy ügynök befejez egy feladatot, ezen a hangon hívlak fel, hogy beszámoljak.",
    degraded: "Nem sikerült összefoglalót készítenem, ezért a teljes jelentés a képernyődön van.",
  },
  id: {
    preview:
      "Halo, saya OutBrief. Saat agen menyelesaikan tugas, saya akan menelepon Anda dengan suara ini untuk melapor.",
    degraded: "Saya tidak bisa menyiapkan ringkasan, jadi laporan lengkapnya ada di layar Anda.",
  },
  is: {
    preview:
      "Halló, ég er OutBrief. Þegar fulltrúi lýkur verkefni hringi ég í þig með þessari rödd og segi frá.",
    degraded: "Ég gat ekki útbúið samantekt, svo öll skýrslan er á skjánum þínum.",
  },
  it: {
    preview:
      "Ciao, sono OutBrief. Quando un agente finisce un'attività, ti chiamerò con questa voce per aggiornarti.",
    degraded:
      "Non sono riuscita a preparare il riepilogo, quindi il rapporto completo è sullo schermo.",
  },
  ja: {
    preview:
      "こんにちは、OutBrief です。エージェントの作業が終わったら、この声でお電話して報告します。",
    degraded: "要約を作れなかったので、報告の原文を画面に表示しています。",
  },
  jv: {
    preview:
      "Halo, aku OutBrief. Yen agen wis rampung tugase, aku bakal nelpon sampeyan nganggo swara iki kanggo lapuran.",
    degraded: "Aku ora bisa nggawe ringkesan, mula laporan lengkape ana ing layar sampeyan.",
  },
  ka: {
    preview:
      "გამარჯობა, მე ვარ OutBrief. როცა აგენტი დავალებას დაასრულებს, ამ ხმით დაგირეკავთ და მოგახსენებთ.",
    degraded: "შეჯამების მომზადება ვერ მოვახერხე, ამიტომ სრული ანგარიში თქვენს ეკრანზეა.",
  },
  kk: {
    preview:
      "Сәлеметсіз бе, мен OutBrief-пін. Агент тапсырманы аяқтағанда, осы дауыспен қоңырау шалып, есеп беремін.",
    degraded: "Қысқаша мазмұнды дайындай алмадым, сондықтан толық есеп экраныңызда.",
  },
  km: {
    preview: "សួស្តី ខ្ញុំគឺ OutBrief។ នៅពេលភ្នាក់ងារបញ្ចប់ការងារ ខ្ញុំនឹងទូរស័ព្ទមកអ្នកដោយសំឡេងនេះដើម្បីរាយការណ៍។",
    degraded: "ខ្ញុំមិនអាចរៀបចំសេចក្តីសង្ខេបបានទេ ដូច្នេះរបាយការណ៍ពេញលេញនៅលើអេក្រង់របស់អ្នក។",
  },
  kn: {
    preview: "ನಮಸ್ಕಾರ, ನಾನು OutBrief. ಏಜೆಂಟ್ ಕೆಲಸ ಮುಗಿಸಿದಾಗ, ಈ ಧ್ವನಿಯಲ್ಲಿ ನಿಮಗೆ ಕರೆ ಮಾಡಿ ತಿಳಿಸುತ್ತೇನೆ.",
    degraded: "ಸಾರಾಂಶ ಸಿದ್ಧಪಡಿಸಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಪೂರ್ಣ ವರದಿ ನಿಮ್ಮ ಪರದೆಯ ಮೇಲಿದೆ.",
  },
  ko: {
    preview:
      "안녕하세요, OutBrief입니다. 에이전트가 작업을 마치면 이 목소리로 전화해서 보고해 드릴게요.",
    degraded: "요약을 만들지 못해서 보고서 원문을 화면에 띄워 두었어요.",
  },
  lo: {
    preview: "ສະບາຍດີ, ຂ້ອຍແມ່ນ OutBrief. ເມື່ອຕົວແທນເຮັດວຽກສຳເລັດ, ຂ້ອຍຈະໂທຫາເຈົ້າດ້ວຍສຽງນີ້ເພື່ອລາຍງານ.",
    degraded: "ຂ້ອຍບໍ່ສາມາດກະກຽມບົດສະຫຼຸບໄດ້, ດັ່ງນັ້ນລາຍງານເຕັມຢູ່ໃນໜ້າຈໍຂອງເຈົ້າ.",
  },
  lt: {
    preview:
      "Sveiki, aš esu OutBrief. Kai agentas baigs užduotį, paskambinsiu jums šiuo balsu ir pranešiu.",
    degraded: "Nepavyko parengti santraukos, todėl visa ataskaita yra jūsų ekrane.",
  },
  lv: {
    preview:
      "Sveiki, es esmu OutBrief. Kad aģents pabeigs uzdevumu, es jums piezvanīšu ar šo balsi un ziņošu.",
    degraded: "Neizdevās sagatavot kopsavilkumu, tāpēc viss ziņojums ir jūsu ekrānā.",
  },
  mk: {
    preview:
      "Здраво, јас сум OutBrief. Кога агент ќе заврши задача, ќе ви се јавам со овој глас да ве известам.",
    degraded: "Не успеав да подготвам резиме, па целиот извештај е на вашиот екран.",
  },
  ml: {
    preview:
      "നമസ്കാരം, ഞാൻ OutBrief ആണ്. ഒരു ഏജന്റ് ജോലി പൂർത്തിയാക്കുമ്പോൾ, ഈ ശബ്ദത്തിൽ ഞാൻ നിങ്ങളെ വിളിച്ച് അറിയിക്കും.",
    degraded: "സംഗ്രഹം തയ്യാറാക്കാനായില്ല, അതിനാൽ മുഴുവൻ റിപ്പോർട്ടും നിങ്ങളുടെ സ്ക്രീനിലുണ്ട്.",
  },
  mn: {
    preview:
      "Сайн байна уу, би OutBrief байна. Агент ажлаа дуусгахад би энэ дуугаар залгаж мэдэгдэнэ.",
    degraded: "Товчлол бэлдэж чадсангүй, тиймээс бүтэн тайлан таны дэлгэц дээр байна.",
  },
  ms: {
    preview:
      "Helo, saya OutBrief. Apabila ejen menyiapkan tugas, saya akan menelefon anda dengan suara ini untuk melaporkannya.",
    degraded: "Saya tidak dapat menyediakan ringkasan, jadi laporan penuh ada di skrin anda.",
  },
  mt: {
    preview:
      "Bongu, jien OutBrief. Meta aġent itemm kompitu, inċempillek b'din il-vuċi biex nirrapporta.",
    degraded: "Ma stajtx inħejji sommarju, għalhekk ir-rapport sħiħ jinsab fuq l-iskrin tiegħek.",
  },
  my: {
    preview: "မင်္ဂလာပါ၊ ကျွန်မက OutBrief ပါ။ အေးဂျင့်တစ်ခု အလုပ်ပြီးတဲ့အခါ ဒီအသံနဲ့ ဖုန်းဆက်ပြီး အစီရင်ခံပါမယ်။",
    degraded: "အနှစ်ချုပ် မပြင်ဆင်နိုင်ခဲ့လို့ အစီရင်ခံစာအပြည့်အစုံကို သင့်ဖန်သားပြင်ပေါ်မှာ ပြထားပါတယ်။",
  },
  nb: {
    preview:
      "Hei, jeg er OutBrief. Når en agent er ferdig med en oppgave, ringer jeg deg med denne stemmen og rapporterer.",
    degraded: "Jeg klarte ikke å lage et sammendrag, så hele rapporten står på skjermen din.",
  },
  ne: {
    preview: "नमस्ते, म OutBrief हुँ। कुनै एजेन्टले काम सकेपछि म यही आवाजमा तपाईंलाई फोन गरेर जानकारी दिनेछु।",
    degraded: "सारांश तयार गर्न सकिनँ, त्यसैले पूरा प्रतिवेदन तपाईंको स्क्रिनमा छ।",
  },
  nl: {
    preview:
      "Hallo, ik ben OutBrief. Als een agent een taak af heeft, bel ik je met deze stem om verslag te doen.",
    degraded: "Ik kon geen samenvatting maken, dus het volledige rapport staat op je scherm.",
  },
  pl: {
    preview:
      "Cześć, jestem OutBrief. Gdy agent skończy zadanie, zadzwonię do ciebie tym głosem i zdam relację.",
    degraded: "Nie udało mi się przygotować podsumowania, więc pełny raport jest na twoim ekranie.",
  },
  ps: {
    preview:
      "سلام، زه OutBrief یم. کله چې یو اجنټ کار پای ته ورسوي، په همدې غږ به تاسو ته زنګ ووهم او راپور به درکړم.",
    degraded: "لنډیز مې چمتو نه کړای شو، نو بشپړ راپور ستاسو په سکرین دی.",
  },
  pt: {
    preview:
      "Olá, eu sou o OutBrief. Quando um agente terminar uma tarefa, vou ligar para você com esta voz para contar.",
    degraded: "Não consegui preparar o resumo, então o relatório completo está na sua tela.",
  },
  ro: {
    preview:
      "Bună, sunt OutBrief. Când un agent termină o sarcină, te voi suna cu această voce ca să-ți raportez.",
    degraded: "Nu am reușit să pregătesc rezumatul, așa că raportul complet este pe ecranul tău.",
  },
  ru: {
    preview:
      "Здравствуйте, я OutBrief. Когда агент закончит задачу, я позвоню вам этим голосом и расскажу.",
    degraded: "Не получилось подготовить сводку, поэтому полный отчёт у вас на экране.",
  },
  si: {
    preview: "ආයුබෝවන්, මම OutBrief. නියෝජිතයෙක් කාර්යයක් අවසන් කළ විට, මම මේ හඬින් ඔබට කතා කර දන්වන්නම්.",
    degraded: "සාරාංශයක් සකස් කිරීමට නොහැකි විය, එබැවින් සම්පූර්ණ වාර්තාව ඔබේ තිරයේ ඇත.",
  },
  sk: {
    preview:
      "Dobrý deň, som OutBrief. Keď agent dokončí úlohu, zavolám vám týmto hlasom a podám správu.",
    degraded: "Nepodarilo sa mi pripraviť zhrnutie, takže celá správa je na vašej obrazovke.",
  },
  sl: {
    preview:
      "Pozdravljeni, sem OutBrief. Ko agent konča nalogo, vas bom poklicala s tem glasom in poročala.",
    degraded: "Povzetka nisem mogla pripraviti, zato je celotno poročilo na vašem zaslonu.",
  },
  so: {
    preview:
      "Salaan, waxaan ahay OutBrief. Marka wakiil uu dhammeeyo hawl, waxaan kugu soo wacayaa codkan si aan kuu warbixiyo.",
    degraded:
      "Ma aan diyaarin karin soo koobid, sidaa darteed warbixinta oo dhan waxay ku jirtaa shaashaddaada.",
  },
  sq: {
    preview:
      "Përshëndetje, unë jam OutBrief. Kur një agjent të përfundojë një detyrë, do t'ju telefonoj me këtë zë për t'ju raportuar.",
    degraded: "Nuk arrita të përgatis përmbledhjen, prandaj raporti i plotë është në ekranin tuaj.",
  },
  sr: {
    preview:
      "Здраво, ја сам OutBrief. Када агент заврши задатак, позваћу вас овим гласом да вас обавестим.",
    degraded: "Нисам успела да припремим сажетак, па је цео извештај на вашем екрану.",
  },
  su: {
    preview:
      "Wilujeng, abdi OutBrief. Upami agén parantos réngsé tugasna, abdi bakal nelepon anjeun nganggo sora ieu pikeun ngalaporkeun.",
    degraded: "Abdi teu tiasa nyiapkeun ringkesan, janten laporan lengkepna aya dina layar anjeun.",
  },
  sv: {
    preview:
      "Hej, jag är OutBrief. När en agent är klar med en uppgift ringer jag dig med den här rösten och berättar.",
    degraded: "Jag kunde inte göra någon sammanfattning, så hela rapporten finns på din skärm.",
  },
  sw: {
    preview:
      "Habari, mimi ni OutBrief. Wakala akimaliza kazi, nitakupigia simu kwa sauti hii kukupa taarifa.",
    degraded: "Sikuweza kuandaa muhtasari, kwa hiyo ripoti kamili iko kwenye skrini yako.",
  },
  ta: {
    preview:
      "வணக்கம், நான் OutBrief. ஒரு ஏஜென்ட் வேலையை முடித்ததும், இந்தக் குரலில் உங்களை அழைத்துத் தெரிவிப்பேன்.",
    degraded: "சுருக்கத்தைத் தயாரிக்க முடியவில்லை, அதனால் முழு அறிக்கையும் உங்கள் திரையில் உள்ளது.",
  },
  te: {
    preview: "నమస్కారం, నేను OutBrief. ఏజెంట్ పని పూర్తి చేసినప్పుడు, ఈ గొంతుతో మీకు ఫోన్ చేసి తెలియజేస్తాను.",
    degraded: "సారాంశం సిద్ధం చేయలేకపోయాను, కాబట్టి పూర్తి నివేదిక మీ స్క్రీన్‌పై ఉంది.",
  },
  th: {
    preview: "สวัสดีค่ะ ฉันคือ OutBrief เมื่อเอเจนต์ทำงานเสร็จ ฉันจะโทรหาคุณด้วยเสียงนี้เพื่อรายงาน",
    degraded: "ฉันสรุปไม่ได้ จึงแสดงรายงานฉบับเต็มไว้บนหน้าจอของคุณแล้วค่ะ",
  },
  tr: {
    preview:
      "Merhaba, ben OutBrief. Bir ajan görevini bitirdiğinde, seni bu sesle arayıp haber vereceğim.",
    degraded: "Özet hazırlayamadım, bu yüzden raporun tamamı ekranında.",
  },
  uk: {
    preview:
      "Вітаю, я OutBrief. Коли агент завершить завдання, я зателефоную вам цим голосом і розповім.",
    degraded: "Не вдалося підготувати підсумок, тому повний звіт у вас на екрані.",
  },
  ur: {
    preview:
      "ہیلو، میں OutBrief ہوں۔ جب کوئی ایجنٹ کام مکمل کرے گا تو میں اسی آواز میں آپ کو فون کر کے بتاؤں گی۔",
    degraded: "میں خلاصہ تیار نہیں کر سکی، اس لیے پوری رپورٹ آپ کی اسکرین پر ہے۔",
  },
  uz: {
    preview:
      "Salom, men OutBriefman. Agent vazifani tugatganda, sizga shu ovozda qo'ng'iroq qilib xabar beraman.",
    degraded: "Qisqacha mazmunni tayyorlay olmadim, shuning uchun to'liq hisobot ekraningizda.",
  },
  vi: {
    preview:
      "Xin chào, tôi là OutBrief. Khi một agent hoàn thành công việc, tôi sẽ gọi cho bạn bằng giọng này để báo cáo.",
    degraded:
      "Tôi chưa tạo được bản tóm tắt, nên toàn bộ báo cáo đang hiển thị trên màn hình của bạn.",
  },
  zh: {
    preview: "你好，我是启奏。Agent 做完任务后，我会用这个声音给你打电话汇报。",
    degraded: "简报没生成出来,原文我放在屏幕上了。",
  },
  "zh-Hant": {
    preview: "你好，我是啟奏。Agent 做完任務後，我會用這個聲音打電話向你匯報。",
    degraded: "簡報沒有生成出來，原文我放在螢幕上了。",
  },
  zu: {
    preview:
      "Sawubona, nginguOutBrief. Uma i-ejenti iqeda umsebenzi, ngizokushayela ngaleli zwi ngikubikele.",
    degraded: "Angikwazanga ukulungisa isifinyezo, ngakho umbiko ogcwele usesikrinini sakho.",
  },
};
