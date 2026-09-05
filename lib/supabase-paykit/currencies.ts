/** ISO currencies for the product sheet picker (code, display name, symbol). */
export interface PaykitCurrency {
  code: string;
  name: string;
  symbol: string;
}

export const PAYKIT_CURRENCIES: PaykitCurrency[] = [
  { code: "usd", name: "US Dollar", symbol: "$" },
  { code: "eur", name: "Euro", symbol: "€" },
  { code: "gbp", name: "British Pound", symbol: "£" },
  { code: "jpy", name: "Japanese Yen", symbol: "¥" },
  { code: "aed", name: "United Arab Emirates Dirham", symbol: "د.إ" },
  { code: "aud", name: "Australian Dollar", symbol: "A$" },
  { code: "brl", name: "Brazilian Real", symbol: "R$" },
  { code: "cad", name: "Canadian Dollar", symbol: "C$" },
  { code: "chf", name: "Swiss Franc", symbol: "CHF" },
  { code: "cny", name: "Chinese Yuan", symbol: "¥" },
  { code: "dkk", name: "Danish Krone", symbol: "kr" },
  { code: "egp", name: "Egyptian Pound", symbol: "E£" },
  { code: "hkd", name: "Hong Kong Dollar", symbol: "HK$" },
  { code: "huf", name: "Hungarian Forint", symbol: "Ft" },
  { code: "idr", name: "Indonesian Rupiah", symbol: "Rp" },
  { code: "ils", name: "Israeli Shekel", symbol: "₪" },
  { code: "inr", name: "Indian Rupee", symbol: "₹" },
  { code: "kes", name: "Kenyan Shilling", symbol: "KSh" },
  { code: "krw", name: "South Korean Won", symbol: "₩" },
  { code: "mxn", name: "Mexican Peso", symbol: "M$" },
  { code: "myr", name: "Malaysian Ringgit", symbol: "RM" },
  { code: "ngn", name: "Nigerian Naira", symbol: "₦" },
  { code: "nok", name: "Norwegian Krone", symbol: "kr" },
  { code: "nzd", name: "New Zealand Dollar", symbol: "NZ$" },
  { code: "php", name: "Philippine Peso", symbol: "₱" },
  { code: "pkr", name: "Pakistani Rupee", symbol: "₨" },
  { code: "pln", name: "Polish Zloty", symbol: "zł" },
  { code: "qar", name: "Qatari Riyal", symbol: "QR" },
  { code: "ron", name: "Romanian Leu", symbol: "lei" },
  { code: "sar", name: "Saudi Riyal", symbol: "﷼" },
  { code: "sek", name: "Swedish Krona", symbol: "kr" },
  { code: "sgd", name: "Singapore Dollar", symbol: "S$" },
  { code: "thb", name: "Thai Baht", symbol: "฿" },
  { code: "try", name: "Turkish Lira", symbol: "₺" },
  { code: "twd", name: "Taiwan Dollar", symbol: "NT$" },
  { code: "uah", name: "Ukrainian Hryvnia", symbol: "₴" },
  { code: "vnd", name: "Vietnamese Dong", symbol: "₫" },
  { code: "zar", name: "South African Rand", symbol: "R" },
];

export function currencySymbol(code: string | null | undefined): string {
  const found = PAYKIT_CURRENCIES.find(
    (c) => c.code === String(code || "usd").toLowerCase(),
  );
  return found ? found.symbol : "$";
}
