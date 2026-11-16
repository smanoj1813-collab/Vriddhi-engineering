/**
 * Inline campus artwork with articulated student figures. A short greeting
 * plays on arrival; hovering replays the wave. CSS respects reduced motion.
 */
export default function CampusIllustration({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`landing-campus-image ${className}`.trim()}
      width="640"
      height="520"
      viewBox="0 0 640 520"
      fill="none"
      role="img"
      aria-labelledby="campus-illustration-title"
      aria-describedby="campus-illustration-desc"
      focusable="false"
    >
      <title id="campus-illustration-title">Students learning and growing together outside an illustrated college campus.</title>
      <desc id="campus-illustration-desc">An illustrated college surrounded by trees, with gently animated students, an open book, and small sparks of growth.</desc>
  <defs>
    <pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#8AB8A4" opacity=".32"/></pattern>
    <linearGradient id="arch" x1="320" y1="40" x2="320" y2="450" gradientUnits="userSpaceOnUse"><stop stopColor="#E0F0E7"/><stop offset="1" stopColor="#EEF6ED"/></linearGradient>
    <linearGradient id="window" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#80B5A4"/><stop offset="1" stopColor="#B4D5C5"/></linearGradient>
  </defs>
  <path d="M70 438V270C70 135 182 43 320 43S570 135 570 270V438Z" fill="url(#arch)"/>
  <path d="M70 438V270C70 135 182 43 320 43S570 135 570 270V438Z" fill="url(#dots)"/>
  <g className="campus-sun">
  <circle cx="471" cy="123" r="31" fill="#F4DCA0"/>
  </g>
  <g className="campus-clouds">
  <path d="M119 173H177M136 161H190M461 194H526M480 183H511" stroke="#FFFDF7" strokeWidth="7" strokeLinecap="round"/>
  </g>
  <g className="campus-connection">
  <path d="M93 246C53 187 113 103 193 91" stroke="#78AA94" strokeWidth="1.5" strokeDasharray="5 7"/>
  <path d="M532 245C594 280 590 367 539 400" stroke="#78AA94" strokeWidth="1.5" strokeDasharray="5 7"/>
  <circle cx="93" cy="246" r="5" fill="#2D8972"/>
  <circle cx="193" cy="91" r="4" fill="#2D8972"/>
  </g>
  <ellipse cx="321" cy="438" rx="258" ry="32" fill="#CFE3D5"/>
  <ellipse cx="322" cy="435" rx="206" ry="17" fill="#B9D2BF" opacity=".55"/>
  <g className="campus-tree-left">
  <path d="M105 321V418M105 365L87 348M105 352L121 333" stroke="#52745A" strokeWidth="7" strokeLinecap="round"/>
  <path d="M105 267C77 267 64 292 70 312C47 333 65 363 91 362C111 378 143 359 140 337C158 313 135 287 122 288C121 275 115 267 105 267Z" fill="#438B6C"/>
  <path d="M105 291V357M105 327L88 312M105 342L123 324" stroke="#83B497" strokeWidth="3" strokeLinecap="round"/>
  </g>
  <g className="campus-tree-right">
  <path d="M541 304V420M541 355L525 339M541 374L558 355" stroke="#52745A" strokeWidth="7" strokeLinecap="round"/>
  <path d="M541 253C518 253 506 274 510 294C486 310 494 339 514 347C510 370 542 382 558 365C584 366 596 338 579 320C589 294 566 276 557 277C558 263 551 253 541 253Z" fill="#76A88A"/>
  <path d="M541 281V365M541 318L526 303M541 342L559 322" stroke="#B5D0AF" strokeWidth="3" strokeLinecap="round"/>
  </g>
  <path d="M111 245H205V401H111Z" fill="#F3F0E2"/>
  <path d="M435 245H529V401H435Z" fill="#E4E8D8"/>
  <path d="M103 233H207V247H103Z" fill="#3D8A72"/>
  <path d="M433 233H537V247H433Z" fill="#2D735E"/>
  <path d="M111 253H205M435 253H529" stroke="#D5DCCB" strokeWidth="5"/>
  <g fill="url(#window)" stroke="#FAF9EE" strokeWidth="4">
    <path d="M129 273H151V310H129ZM169 273H191V310H169ZM129 333H151V370H129ZM169 333H191V370H169Z"/>
    <path d="M449 273H471V310H449ZM489 273H511V310H489ZM449 333H471V370H449ZM489 333H511V370H489Z"/>
  </g>
  <path d="M140 274V309M180 274V309M140 334V369M180 334V369M460 274V309M500 274V309M460 334V369M500 334V369" stroke="#FAF9EE" strokeWidth="3"/>
  <path d="M107 397H207V407H107ZM433 397H534V407H433Z" fill="#CDD6C4"/>
  <path d="M449 173L470 187V405H449Z" fill="#D5DCCB"/>
  <path d="M190 173H450V405H190Z" fill="#FFFCF0"/>
  <path d="M173 171L320 82L467 171Z" fill="#185F50"/>
  <path d="M201 158L320 98L439 158Z" fill="#3B8C73"/>
  <path d="M222 157L320 110L418 157Z" fill="#F4EFDF"/>
  <path d="M173 169H467V181H173Z" fill="#155847"/>
  <path d="M184 181H456V188H184Z" fill="#E1E4D3"/>
  <circle cx="320" cy="139" r="15" fill="#FFFCF0"/>
  <circle cx="320" cy="139" r="12" stroke="#B6C9B4" strokeWidth="1.5"/>
  <path d="M320 130V139L326 143" stroke="#276B56" strokeWidth="2.5" strokeLinecap="round"/>
  <text x="320" y="213" textAnchor="middle" fill="#3C6A57" fontFamily="Arial, sans-serif" fontSize="12" fontWeight="700" letterSpacing="4">VRIDDHI</text>
  <path d="M276 224H364" stroke="#D8DFCC" strokeWidth="2"/>
  <g fill="#E8E8D7">
    <path d="M202 233H216V397H202ZM254 233H268V397H254ZM372 233H386V397H372ZM424 233H438V397H424Z"/>
  </g>
  <g fill="#FCFBF1">
    <path d="M198 229H220V237H198ZM250 229H272V237H250ZM368 229H390V237H368ZM420 229H442V237H420Z"/>
    <path d="M198 391H220V400H198ZM250 391H272V400H250ZM368 391H390V400H368ZM420 391H442V400H420Z"/>
  </g>
  <g fill="url(#window)" stroke="#E1E5D3" strokeWidth="4">
    <path d="M226 251H245V295H226ZM395 251H414V295H395ZM226 319H245V363H226ZM395 319H414V363H395Z"/>
  </g>
  <path d="M227 273H244M396 273H413M227 341H244M396 341H413" stroke="#F9F8ED" strokeWidth="3"/>
  <path d="M282 402V305C282 284 299 267 320 267C341 267 358 284 358 305V402Z" fill="#E2E5D3"/>
  <path d="M289 402V306C289 289 303 275 320 275C337 275 351 289 351 306V402Z" fill="#216650"/>
  <path d="M296 308C296 294 306 283 320 283C334 283 344 294 344 308Z" fill="#9CC7AF"/>
  <path d="M320 283V401M295 313H345" stroke="#D9E5D1" strokeWidth="3"/>
  <path d="M298 323H313V382H298ZM327 323H342V382H327Z" fill="#3E8268"/>
  <path d="M312 347V358M328 347V358" stroke="#F3D594" strokeWidth="3" strokeLinecap="round"/>
  <path d="M274 402H366V411H274Z" fill="#E9E9D8"/>
  <path d="M262 411H378V420H262Z" fill="#D2D9C6"/>
  <path d="M249 420H391V429H249Z" fill="#E9E9D8"/>
  <path d="M249 429H391" stroke="#B9C9B5" strokeWidth="3"/>
  <path d="M121 418C119 400 134 391 146 399C150 380 177 382 181 401C198 393 211 405 207 418Z" fill="#659777"/>
  <path d="M445 419C441 403 454 391 468 399C474 381 497 387 499 402C515 394 527 406 523 419Z" fill="#4D896A"/>
  <path d="M134 419H199L194 435H140Z" fill="#D4B783"/>
  <path d="M454 419H516L511 435H459Z" fill="#DEC69C"/>
  <g className="campus-student campus-student-left">
  <ellipse cx="173" cy="456" rx="28" ry="6" fill="#AEC8B5" opacity=".65"/>
  <path d="M164 410L160 447L150 453" stroke="#244E46" strokeWidth="11" strokeLinecap="round"/>
  <path d="M179 410L185 445L194 450" stroke="#316257" strokeWidth="11" strokeLinecap="round"/>
  <path d="M147 454H160M187 452H200" stroke="#183E37" strokeWidth="6" strokeLinecap="round"/>
  <path d="M157 372C153 375 151 389 153 408L180 413C187 397 188 381 180 374Z" fill="#E8B762"/>
  <path d="M155 376C143 375 140 387 142 404L154 408Z" fill="#2B7B63"/>
  <g className="campus-arm campus-arm-left">
    <path d="M178 380L187 397L202 391" stroke="#E8B762" strokeWidth="10" strokeLinecap="round"/>
    <path d="M188 397L201 391" stroke="#B97C58" strokeWidth="7" strokeLinecap="round"/>
    <path d="M194 380L210 377L215 397L199 401Z" fill="#FDF9E9" stroke="#477E67" strokeWidth="2"/>
    <path d="M199 383L207 381M201 388L209 386" stroke="#A8BCA0" strokeWidth="2"/>
  </g>
  <g className="campus-head campus-head-left">
    <path d="M167 365V376" stroke="#B97C58" strokeWidth="8"/>
    <ellipse cx="170" cy="354" rx="13" ry="16" fill="#C58A63"/>
    <path d="M157 355C151 340 163 333 174 336C187 337 186 349 181 354L177 346C170 350 163 347 161 357Z" fill="#243E35"/>
    <circle cx="178" cy="355" r="1.3" fill="#243E35"/>
    <path d="M177 362L181 361" stroke="#8F573E" strokeWidth="1.5" strokeLinecap="round"/>
  </g>
  </g>
  <g className="campus-student campus-student-right">
  <ellipse cx="460" cy="458" rx="27" ry="6" fill="#AEC8B5" opacity=".65"/>
  <path d="M449 410L447 449M465 410L473 448" stroke="#E3D9BC" strokeWidth="12" strokeLinecap="round"/>
  <path d="M441 453H453M469 453H482" stroke="#285247" strokeWidth="6" strokeLinecap="round"/>
  <path d="M449 369C440 378 440 397 438 414C449 420 465 419 475 413L468 375Z" fill="#D99377"/>
  <path d="M447 379L437 399L446 407" stroke="#D99377" strokeWidth="10" strokeLinecap="round"/>
  <path d="M439 401L447 407" stroke="#AE7354" strokeWidth="7" strokeLinecap="round"/>
  <g className="campus-arm campus-arm-right">
    <path d="M466 380L476 397L486 390" stroke="#D99377" strokeWidth="10" strokeLinecap="round"/>
    <path d="M477 396L486 389" stroke="#AE7354" strokeWidth="7" strokeLinecap="round"/>
    <path d="M479 381L496 386L491 405L474 400Z" fill="#276D57"/>
    <path d="M482 385L491 388M480 390L489 393" stroke="#B4D0AF" strokeWidth="2"/>
  </g>
  <g className="campus-head campus-head-right">
    <path d="M455 363V374" stroke="#AE7354" strokeWidth="8"/>
    <path d="M440 351C438 331 467 327 472 347L475 374H438Z" fill="#303E32"/>
    <ellipse cx="457" cy="352" rx="12" ry="15" fill="#B7805C"/>
    <path d="M444 350C445 334 465 333 470 348C460 348 454 342 453 339C452 346 448 349 444 350Z" fill="#303E32"/>
    <circle cx="451" cy="353" r="1.3" fill="#303E32"/>
    <path d="M449 360L453 361" stroke="#845337" strokeWidth="1.5" strokeLinecap="round"/>
  </g>
  </g>
  <g className="campus-book">
  <ellipse cx="324" cy="468" rx="57" ry="9" fill="#B5CDBB" opacity=".6"/>
  <path d="M269 445L319 457L371 443L374 463L321 478L267 464Z" fill="#216C55"/>
  <path d="M272 438C290 435 307 441 320 450C335 438 353 433 369 435L371 457C352 456 337 462 320 471C304 462 287 458 270 459Z" fill="#FFFCF0"/>
  <path d="M320 450V470M280 446C291 446 303 450 311 455M280 452C291 452 302 456 310 460M330 453C340 447 350 444 361 443M331 459C341 454 350 451 361 450" stroke="#C4D4BC" strokeWidth="2" strokeLinecap="round"/>
  </g>
  <g className="campus-sparkles">
  <path d="M552 179V195M544 187H560" stroke="#E2B45D" strokeWidth="3" strokeLinecap="round"/>
  <path d="M65 375V387M59 381H71" stroke="#4F9478" strokeWidth="3" strokeLinecap="round"/>
  <path d="M233 78V90M227 84H239" stroke="#E2B45D" strokeWidth="3" strokeLinecap="round"/>
  <circle cx="514" cy="449" r="4" fill="#E2B45D"/>
  <circle cx="113" cy="119" r="4" fill="#75A78A"/>
  </g>
    </svg>
  );
}
