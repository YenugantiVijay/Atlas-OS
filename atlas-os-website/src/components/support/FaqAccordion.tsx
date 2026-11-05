import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { FAQS } from "../../data/faqs";

export default function FaqAccordion() {
  const [openIds, setOpenIds] = useState<string[]>([
    "what-is-atlas-os",
    "target-audience",
  ]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");

  const categories = [
    "All",
    "General",
    "Product & Features",
    "Download & Deployment",
    "Security & Compliance",
    "Pricing & Trials",
  ];

  const toggleFaq = (id: string) => {
    setOpenIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const filteredFaqs = FAQS.filter((faq) => {
    const matchesCategory =
      activeCategory === "All" || faq.category === activeCategory;
    const matchesQuery =
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="space-y-8">
      {/* Search & Filter Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative w-full sm:w-80">
          <input
            type="text"
            placeholder="Search questions or topics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-4 text-xs rounded-xl border border-border bg-white text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-600 shadow-2xs"
          />
          <Search className="w-4 h-4 text-content-muted absolute left-3.5 top-3.5" />
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeCategory === cat
                  ? "bg-brand-600 text-white shadow-2xs"
                  : "bg-surface-secondary text-content-secondary hover:text-content-primary hover:bg-white border border-border"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Accordion List */}
      <div className="space-y-3">
        {filteredFaqs.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-border bg-surface-secondary text-content-secondary text-xs">
            No frequently asked questions match your search query "{searchQuery}
            ". Please email{" "}
            <a
              href="mailto:support@atlasos.business"
              className="text-brand-600 font-semibold underline"
            >
              support@atlasos.business
            </a>{" "}
            for assistance.
          </div>
        ) : (
          filteredFaqs.map((faq) => {
            const isOpen = openIds.includes(faq.id);
            return (
              <div
                key={faq.id}
                className={`rounded-2xl border transition-all duration-150 overflow-hidden ${
                  isOpen
                    ? "border-brand-300 bg-brand-50/20 shadow-sm"
                    : "border-border bg-white hover:border-brand-200"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(faq.id)}
                  className="w-full p-5 text-left flex items-center justify-between gap-4 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  aria-expanded={isOpen}
                >
                  <span className="text-sm font-bold font-display text-content-primary pr-2">
                    {faq.question}
                  </span>
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 ${
                      isOpen
                        ? "rotate-180 bg-brand-100 text-brand-700"
                        : "bg-surface-secondary text-content-secondary"
                    }`}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 pt-0 text-xs text-content-secondary leading-relaxed border-t border-brand-100/50 mt-1 animate-fade-in">
                    <p className="pt-3">{faq.answer}</p>
                    <span className="inline-block mt-3 px-2 py-0.5 rounded text-[10px] font-semibold bg-surface-secondary text-content-muted">
                      Category: {faq.category}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
