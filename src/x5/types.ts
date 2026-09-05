export interface X5HistoryRequest { page: number; type: 'receipts'; from: string; to: string; codeTc: string }
export interface DecodedHistory { receipts: unknown[]; isNewData?: boolean }
export interface X5Client { getReceiptHistory(request: X5HistoryRequest, signal?: AbortSignal): Promise<DecodedHistory> }
export interface ReceiptItem {
  pluId: string | null; name: string; quantity: number; unit: string | null;
  regularPrice: number | null; paidPrice: number | null; linePaid: number | null;
  discount: number | null; categoryCode: string | null; imageUrl: string | null;
}
export interface Receipt {
  id: string; transactionId: string | null; createdAt: string; purchaseDate: string;
  networkCode: string | null; title: string | null; storeId: string | null; storeAddress: string | null;
  totalRegular: number | null; totalPaid: number | null; discount: number | null;
  checkNumber: string | null; fiscalNumber: string | null; ofdUrl: string | null;
  items: ReceiptItem[];
}
