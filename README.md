# Branch Ops

Fleet yard management for truck rental operations.

## Stack
- **Next.js 14** (App Router)
- **Supabase** (state persistence)
- **Anthropic Claude** (AI command bar — server-side)

## Setup

### 1. Clone & install
```bash
git clone https://github.com/your-username/branch-ops.git
cd branch-ops
npm install
```

### 2. Supabase table
In your Supabase project → SQL Editor, run:
```sql
CREATE TABLE branch_ops (
  id   UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  key  TEXT UNIQUE NOT NULL,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow all access (add auth later if needed)
ALTER TABLE branch_ops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON branch_ops FOR ALL USING (true) WITH CHECK (true);
```

### 3. Environment variables
Copy `.env.example` to `.env.local` and fill in your keys:
```bash
cp .env.example .env.local
```

### 4. Run locally
```bash
npm run dev
```

## Deploy to Vercel
1. Push to GitHub
2. Import repo in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

## AI Command Bar examples
- `"Ground 529835 for CFI"`
- `"529835 going out to John Smith back June 20"`
- `"529835 is back, put it on WL"`
- `"Need a 26ft for tomorrow, hold it"`
- `"Schedule PM for 529835, routine"`
- `"Hike 529835 out to Concord"`
