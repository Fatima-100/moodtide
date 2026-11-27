// Artist lists for import-catalog.mjs, one list per genre (task A16).
// Pure data, no database: the tests and the import schedule read it too.
//
//   [artist name as iTunes spells it, region fallback, country]
// The region is only the FALLBACK: Last.fm tags decide first. Allowed: pakistani, punjabi, indian, korean, japanese, international.
// One search costs 100 YouTube units, so every artist on this list is 100 units per run (see docs/import-schedule.xlsx).

/** genre key -> genre_id in the database (db/init/02_seed.sql and 03_genres.sql) */
export const GENRE_IDS = {
  ghazal: 'gen_ghazal', qawwali: 'gen_qawwali', sufi: 'gen_sufi_kalam',
  punjabi_folk: 'gen_punjabi_folk', punjabi_pop: 'gen_punjabi_pop', urdu_pop: 'gen_urdu_pop', coke: 'gen_coke_studio',
  bollywood: 'gen_bollywood', kpop: 'gen_kpop', jpop: 'gen_jpop', hiphop: 'gen_hiphop',
  lofi: 'gen_2',                       // "Lo-Fi Chillhop" from the seed
};

export const GENRE_ARTISTS = {
  ghazal: [
    ['Mehdi Hassan', 'pakistani', 'PK'], ['Ghulam Ali', 'pakistani', 'PK'], ['Farida Khanum', 'pakistani', 'PK'],
    ['Iqbal Bano', 'pakistani', 'PK'], ['Noor Jehan', 'pakistani', 'PK'], ['Runa Laila', 'pakistani', 'BD'],
    ['Jagjit Singh', 'indian', 'IN'], ['Pankaj Udhas', 'indian', 'IN'],
  ],
  qawwali: [
    ['Nusrat Fateh Ali Khan', 'pakistani', 'PK'], ['Rahat Fateh Ali Khan', 'pakistani', 'PK'], ['Sabri Brothers', 'pakistani', 'PK'],
    ['Amjad Sabri', 'pakistani', 'PK'], ['Aziz Mian', 'pakistani', 'PK'], ['Fareed Ayaz', 'pakistani', 'PK'],
  ],
  sufi: [
    ['Abida Parveen', 'pakistani', 'PK'], ['Arooj Aftab', 'pakistani', 'PK'], ['Sain Zahoor', 'pakistani', 'PK'],
    ['Pathanay Khan', 'pakistani', 'PK'], ['Sanam Marvi', 'pakistani', 'PK'],
  ],
  punjabi_folk: [
    ['Alam Lohar', 'punjabi', 'PK'], ['Arif Lohar', 'punjabi', 'PK'], ['Reshma', 'punjabi', 'PK'],
    ['Attaullah Khan Esakhelvi', 'pakistani', 'PK'],
    ['Gurdas Maan', 'punjabi', 'IN'], ['Babbu Maan', 'punjabi', 'IN'], ['Satinder Sartaaj', 'punjabi', 'IN'],
    ['Kuldeep Manak', 'punjabi', 'IN'], ['Surinder Shinda', 'punjabi', 'IN'],
  ],
  punjabi_pop: [
    ['Diljit Dosanjh', 'punjabi', 'IN'], ['Karan Aujla', 'punjabi', 'IN'], ['AP Dhillon', 'punjabi', 'IN'],
    ['Sidhu Moose Wala', 'punjabi', 'IN'], ['Ammy Virk', 'punjabi', 'IN'], ['Jasmine Sandlas', 'punjabi', 'IN'],
    ['Gippy Grewal', 'punjabi', 'IN'], ['Jazzy B', 'punjabi', 'IN'], ['Amrinder Gill', 'punjabi', 'IN'],
    ['B Praak', 'punjabi', 'IN'], ['Guru Randhawa', 'punjabi', 'IN'], ['Sharry Mann', 'punjabi', 'IN'],
  ],
  urdu_pop: [
    ['Atif Aslam', 'pakistani', 'PK'], ['Ali Zafar', 'pakistani', 'PK'], ['Asim Azhar', 'pakistani', 'PK'],
    ['Hasan Raheem', 'pakistani', 'PK'], ['Momina Mustehsan', 'pakistani', 'PK'], ['Quratulain Balouch', 'pakistani', 'PK'],
    ['Shiraz Uppal', 'pakistani', 'PK'], ['Hadiqa Kiani', 'pakistani', 'PK'], ['Nazia Hassan', 'pakistani', 'PK'],
    ['Strings', 'pakistani', 'PK'], ['Junoon', 'pakistani', 'PK'], ['Fuzon', 'pakistani', 'PK'],
    ['Noori', 'pakistani', 'PK'], ['Sajjad Ali', 'pakistani', 'PK'],
  ],
  coke: [
    ['Ali Sethi', 'pakistani', 'PK'], ['Gul Panra', 'pakistani', 'PK'], ['Zeb Bangash', 'pakistani', 'PK'],
    ['Naseebo Lal', 'punjabi', 'PK'], ['Fariha Pervez', 'pakistani', 'PK'], ['Meesha Shafi', 'pakistani', 'PK'],
    ['Kaavish', 'pakistani', 'PK'], ['Mekaal Hasan Band', 'pakistani', 'PK'], ['Shae Gill', 'pakistani', 'PK'],
  ],
  bollywood: [
    ['Arijit Singh', 'indian', 'IN'], ['Shreya Ghoshal', 'indian', 'IN'], ['Sonu Nigam', 'indian', 'IN'],
    ['A. R. Rahman', 'indian', 'IN'], ['Neha Kakkar', 'indian', 'IN'], ['Lata Mangeshkar', 'indian', 'IN'],
    ['Mohammed Rafi', 'indian', 'IN'], ['Kishore Kumar', 'indian', 'IN'], ['Alka Yagnik', 'indian', 'IN'],
    ['Udit Narayan', 'indian', 'IN'], ['Sunidhi Chauhan', 'indian', 'IN'], ['Jubin Nautiyal', 'indian', 'IN'],
    ['Armaan Malik', 'indian', 'IN'], ['Darshan Raval', 'indian', 'IN'], ['Kumar Sanu', 'indian', 'IN'],
  ],
  kpop: [
    ['BTS', 'korean', 'KR'], ['BLACKPINK', 'korean', 'KR'], ['IU', 'korean', 'KR'], ['NewJeans', 'korean', 'KR'],
    ['Stray Kids', 'korean', 'KR'], ['TWICE', 'korean', 'KR'], ['EXO', 'korean', 'KR'], ['SEVENTEEN', 'korean', 'KR'],
    ['Red Velvet', 'korean', 'KR'], ['aespa', 'korean', 'KR'], ['IVE', 'korean', 'KR'], ['LE SSERAFIM', 'korean', 'KR'],
    ['Taeyeon', 'korean', 'KR'], ['G-DRAGON', 'korean', 'KR'],
  ],
  jpop: [
    ['YOASOBI', 'japanese', 'JP'], ['Hikaru Utada', 'japanese', 'JP'], ['Kenshi Yonezu', 'japanese', 'JP'],
    ['Ado', 'japanese', 'JP'], ['LiSA', 'japanese', 'JP'], ['Aimer', 'japanese', 'JP'], ['Fujii Kaze', 'japanese', 'JP'],
    ['Official HIGE DANdism', 'japanese', 'JP'], ['Mrs. GREEN APPLE', 'japanese', 'JP'], ['Yorushika', 'japanese', 'JP'],
  ],
  hiphop: [
    ['Talha Anjum', 'pakistani', 'PK'], ['Faris Shafi', 'pakistani', 'PK'], ['Young Stunners', 'pakistani', 'PK'],
    ['Bohemia', 'pakistani', 'PK'], ['Eva B', 'pakistani', 'PK'],
    ['Badshah', 'indian', 'IN'], ['Yo Yo Honey Singh', 'indian', 'IN'], ['Raftaar', 'indian', 'IN'], ['Divine', 'indian', 'IN'],
  ],
  lofi: [
    ['Nujabes', 'international', 'JP'], ['Jinsang', 'international', 'US'], ['Idealism', 'international', 'FI'],
    ['tomppabeats', 'international', 'FI'],
  ],
};

/** Flat list: [name, region, country, genreKey]. */
export const ARTISTS = Object.entries(GENRE_ARTISTS).flatMap(([genreKey, list]) =>
  list.map(([name, region, country]) => [name, region, country, genreKey]));

export const REGIONS = ['pakistani', 'punjabi', 'indian', 'korean', 'japanese', 'international'];
