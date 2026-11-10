export function isPcg2005StockAccountCode(value: string): boolean {
  return /^(31|32|33|34|35|37|38)\\d{0,4}$/.test(value);
}
