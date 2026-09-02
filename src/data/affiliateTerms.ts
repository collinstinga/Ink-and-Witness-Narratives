export const AFFILIATE_TERMS_VERSION = "2026.1";

export interface AffiliateTermsSection {
  title: string;
  content: string[];
}

export const AFFILIATE_TERMS_TITLE = "Ink & Witness Narratives";
export const AFFILIATE_TERMS_SUBTITLE = "Affiliate Programme Terms & Conditions";
export const AFFILIATE_TERMS_PREAMBLE = "Please read these Terms carefully before joining the Affiliate Programme.";

export const AFFILIATE_TERMS_SECTIONS: AffiliateTermsSection[] = [
  { title: "1. Your Role", content: ["You are an independent affiliate of Ink & Witness Narratives.", "You are not an employee, partner, agent, owner, or legal representative of Ink & Witness Narratives.", "You are free to decide how, where, and when you promote our pieces, provided your marketing is lawful, genuine, and not deliberately misleading."] },
  { title: "2. Commission", content: ["Standard ebook price: KSh 1,500", "Affiliate commission: 15%", "Commission per qualifying sale: KSh 225", "Commission is earned from genuine purchases made by other customers and successfully attributed to your unique affiliate link.", "Refunded, cancelled, reversed, fraudulent, or otherwise invalid transactions do not qualify for commission.", "Commissions are attributed on a 30-day cookie window: if a visitor clicks your link and completes a purchase within 30 days, the commission is credited to you."] },
  { title: "3. No Self-Purchase Commissions", content: ["You may not purchase pieces through your own affiliate link to claim a discount or commission.", "Any commission generated through self-referral, device/phone matching, or artificial order routing will be reversed."] },
  { title: "4. Payouts", content: ["Commissions are disbursed through your selected payout method (M-Pesa B2C, Bank Transfer, or PayPal).", "Minimum payout threshold: KSh 1,000.", "Payouts are processed once your available balance reaches or exceeds the threshold and you submit a payout request.", "Ensure your registered payout details (M-Pesa number, bank account, or PayPal email) are accurate. Ink & Witness Narratives is not liable for funds sent to incorrect accounts provided by you."] },
  { title: "5. Respecting Readers & Responsible Promotion", content: ["We write about human contradictions, intimacy, vulnerability, and complex stories. We treat our readers with respect.", "You agree to promote our work with equal respect and integrity.", "You may not:", "• Send unsolicited spam across WhatsApp, Telegram, email, SMS, or direct messages.", "• Make false promises, deceptive claims, or misrepresent the contents of any piece.", "• Use aggressive, harassing, deceptive, or offensive promotional tactics.", "• Impersonate Jake or Ink & Witness Narratives directly as the sole author or official owner."] },
  { title: "6. Intellectual Property & Content Protection", content: ["All writing, essays, monographs, erotica, and narratives on Ink & Witness Narratives belong exclusively to the author (Jake).", "You may share official excerpts, titles, quotes, summaries, and promotional artwork provided in the affiliate portal.", "You may NOT copy, reproduce, resell, re-distribute, leak, or upload full monographs, ebook PDFs, or paid chapters anywhere online."] },
  { title: "7. Account Suspension & Termination", content: ["Ink & Witness Narratives reserves the right to suspend or terminate any affiliate account and withhold fraudulent commissions if these terms are violated.", "Violations include spamming, self-dealing, fraudulent transactions, intellectual property theft, or deceptive advertising."] },
  { title: "8. Amendments & Updates", content: ["Ink & Witness Narratives may update these Terms & Conditions from time to time.", "Affiliates will be notified in their dashboard and must accept updated terms to continue active participation in the programme."] }
];

export interface AffiliateTermsCheckbox { id: string; label: string; }

export const AFFILIATE_TERMS_CHECKBOXES: AffiliateTermsCheckbox[] = [
  { id: "independent_role", label: "I understand that I am an independent affiliate, not an employee, agent, or legal representative of Ink & Witness Narratives." },
  { id: "commission_structure", label: "I acknowledge the 15% commission rate (KSh 225 on standard KSh 1,500 pieces) on genuine qualifying sales attributed to my referral link." },
  { id: "no_self_purchases", label: "I agree that self-referrals and purchasing through my own link to claim discounts or commissions are strictly prohibited and will be voided." },
  { id: "payout_threshold", label: "I understand the KSh 1,000 minimum payout threshold and confirm my payout information is correct and lawfully mine." },
  { id: "no_spam_harassment", label: "I agree never to engage in unsolicited spam, misleading advertising, harassing outreach, or deceptive promotional claims." },
  { id: "content_protection", label: "I agree to protect the author's copyright and will never re-upload, re-distribute, leak, or resell full paid pieces or ebooks." },
  { id: "respect_readers", label: "I will represent the writing with integrity, honesty, and respect for readers and the themes explored." },
  { id: "account_terms_compliance", label: "I acknowledge that violating these Terms may lead to immediate account suspension and forfeiture of unearned/fraudulent commissions." },
  { id: "accept_all_terms", label: "I have read, understood, and accept all the Ink & Witness Narratives Affiliate Programme Terms & Conditions in full." }
];
