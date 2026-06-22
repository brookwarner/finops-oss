export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_tokens: {
        Row: {
          created_at: string
          household_id: string
          id: string
          last_used_at: string | null
          name: string
          prefix: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          last_used_at?: string | null
          name: string
          prefix?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          last_used_at?: string | null
          name?: string
          prefix?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_tokens_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          akahu_account_id: string
          akahu_status: string | null
          attributes: string[]
          balance_available: number | null
          balance_current: number | null
          created_at: string
          currency: string
          household_id: string
          id: string
          institution: string
          investment_inception_date: string | null
          is_emergency_fund: boolean
          emergency_fund_target_months: number
          is_reserve_buffer: boolean
          is_revolving_facility: boolean
          name: string
          refreshed_balance_at: string | null
          refreshed_meta_at: string | null
          refreshed_party_at: string | null
          refreshed_transactions_at: string | null
          type: string
        }
        Insert: {
          akahu_account_id: string
          akahu_status?: string | null
          attributes?: string[]
          balance_available?: number | null
          balance_current?: number | null
          created_at?: string
          currency?: string
          household_id: string
          id?: string
          institution: string
          investment_inception_date?: string | null
          is_emergency_fund?: boolean
          emergency_fund_target_months?: number
          is_reserve_buffer?: boolean
          is_revolving_facility?: boolean
          name: string
          refreshed_balance_at?: string | null
          refreshed_meta_at?: string | null
          refreshed_party_at?: string | null
          refreshed_transactions_at?: string | null
          type: string
        }
        Update: {
          akahu_account_id?: string
          akahu_status?: string | null
          attributes?: string[]
          balance_available?: number | null
          balance_current?: number | null
          created_at?: string
          currency?: string
          household_id?: string
          id?: string
          institution?: string
          investment_inception_date?: string | null
          is_emergency_fund?: boolean
          emergency_fund_target_months?: number
          is_reserve_buffer?: boolean
          is_revolving_facility?: boolean
          name?: string
          refreshed_balance_at?: string | null
          refreshed_meta_at?: string | null
          refreshed_party_at?: string | null
          refreshed_transactions_at?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      akahu_categories: {
        Row: {
          created_at: string
          groups: Json | null
          id: string
          name: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string
          groups?: Json | null
          id: string
          name: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string
          groups?: Json | null
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "akahu_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "akahu_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      akahu_config: {
        Row: {
          id: boolean
          updated_at: string
          user_token: string
        }
        Insert: {
          id?: boolean
          updated_at?: string
          user_token: string
        }
        Update: {
          id?: boolean
          updated_at?: string
          user_token?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          body: string
          category_id: string | null
          delivered: boolean
          delivery_error: string | null
          fired_at: string
          household_id: string
          id: string
          payload: Json | null
          period_start: string | null
          state: string | null
          subscription_id: string | null
          title: string
          txn_id: string | null
          type: string
        }
        Insert: {
          body: string
          category_id?: string | null
          delivered?: boolean
          delivery_error?: string | null
          fired_at?: string
          household_id: string
          id?: string
          payload?: Json | null
          period_start?: string | null
          state?: string | null
          subscription_id?: string | null
          title: string
          txn_id?: string | null
          type: string
        }
        Update: {
          body?: string
          category_id?: string | null
          delivered?: boolean
          delivery_error?: string | null
          fired_at?: string
          household_id?: string
          id?: string
          payload?: Json | null
          period_start?: string | null
          state?: string | null
          subscription_id?: string | null
          title?: string
          txn_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_txn_id_fkey"
            columns: ["txn_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      amortising_liabilities: {
        Row: {
          akahu_account_id: string
          anchor_balance: number
          anchor_date: string
          annual_rate: number
          created_at: string
          household_id: string
          id: string
          repayment_category_id: string
        }
        Insert: {
          akahu_account_id: string
          anchor_balance: number
          anchor_date: string
          annual_rate?: number
          created_at?: string
          household_id: string
          id?: string
          repayment_category_id: string
        }
        Update: {
          akahu_account_id?: string
          anchor_balance?: number
          anchor_date?: string
          annual_rate?: number
          created_at?: string
          household_id?: string
          id?: string
          repayment_category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amortising_liabilities_akahu_account_id_fkey"
            columns: ["akahu_account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["akahu_account_id"]
          },
          {
            foreignKeyName: "amortising_liabilities_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amortising_liabilities_repayment_category_id_fkey"
            columns: ["repayment_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_periods: {
        Row: {
          budget_id: string
          carryover: number
          effective_spend: number
          household_id: string
          id: string
          kind: string
          pct: number
          period_end: string
          period_start: string
          reimbursed: number
          reserve_balance: number | null
          spent: number
          status: string
          target: number
          updated_at: string
        }
        Insert: {
          budget_id: string
          carryover?: number
          effective_spend?: number
          household_id: string
          id?: string
          kind: string
          pct?: number
          period_end: string
          period_start: string
          reimbursed?: number
          reserve_balance?: number | null
          spent?: number
          status?: string
          target: number
          updated_at?: string
        }
        Update: {
          budget_id?: string
          carryover?: number
          effective_spend?: number
          household_id?: string
          id?: string
          kind?: string
          pct?: number
          period_end?: string
          period_start?: string
          reimbursed?: number
          reserve_balance?: number | null
          spent?: number
          status?: string
          target?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_periods_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_periods_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          active: boolean
          category_id: string
          created_at: string
          household_id: string
          id: string
          kind: string
          linked_account_id: string | null
          monthly_target: number
          reserve_balance: number
        }
        Insert: {
          active?: boolean
          category_id: string
          created_at?: string
          household_id: string
          id?: string
          kind: string
          linked_account_id?: string | null
          monthly_target: number
          reserve_balance?: number
        }
        Update: {
          active?: boolean
          category_id?: string
          created_at?: string
          household_id?: string
          id?: string
          kind?: string
          linked_account_id?: string | null
          monthly_target?: number
          reserve_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_linked_account_id_fkey"
            columns: ["linked_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string | null
          context: string
          created_at: string
          group: string | null
          household_id: string
          icon: string | null
          id: string
          income_type: string | null
          kind: string
          name: string
          parent_id: string | null
          spend_class: string | null
        }
        Insert: {
          color?: string | null
          context?: string
          created_at?: string
          group?: string | null
          household_id: string
          icon?: string | null
          id?: string
          income_type?: string | null
          kind: string
          name: string
          parent_id?: string | null
          spend_class?: string | null
        }
        Update: {
          color?: string | null
          context?: string
          created_at?: string
          group?: string | null
          household_id?: string
          icon?: string | null
          id?: string
          income_type?: string | null
          kind?: string
          name?: string
          parent_id?: string | null
          spend_class?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      category_rules: {
        Row: {
          category_id: string
          confidence: number | null
          created_at: string
          field: string
          household_id: string
          id: string
          match_type: string
          match_value: string
          max_amount: number | null
          min_amount: number | null
          priority: number
          source: string
        }
        Insert: {
          category_id: string
          confidence?: number | null
          created_at?: string
          field?: string
          household_id: string
          id?: string
          match_type: string
          match_value: string
          max_amount?: number | null
          min_amount?: number | null
          priority?: number
          source?: string
        }
        Update: {
          category_id?: string
          confidence?: number | null
          created_at?: string
          field?: string
          household_id?: string
          id?: string
          match_type?: string
          match_value?: string
          max_amount?: number | null
          min_amount?: number | null
          priority?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_rules_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      dedupe_ps_backup_20260603: {
        Row: {
          account_id: string | null
          akahu_category_id: string | null
          akahu_merchant_id: string | null
          akahu_transaction_id: string | null
          akahu_type: string | null
          amount: number | null
          balance_after: number | null
          card_suffix: string | null
          category_id: string | null
          code: string | null
          conversion: Json | null
          created_at: string | null
          description: string | null
          household_id: string | null
          id: string | null
          is_manual_category: boolean | null
          last_seen_at: string | null
          merchant: string | null
          merchant_logo_url: string | null
          needs_review: boolean | null
          occurred_at: string | null
          other_account: string | null
          particulars: string | null
          raw: Json | null
          reference: string | null
        }
        Insert: {
          account_id?: string | null
          akahu_category_id?: string | null
          akahu_merchant_id?: string | null
          akahu_transaction_id?: string | null
          akahu_type?: string | null
          amount?: number | null
          balance_after?: number | null
          card_suffix?: string | null
          category_id?: string | null
          code?: string | null
          conversion?: Json | null
          created_at?: string | null
          description?: string | null
          household_id?: string | null
          id?: string | null
          is_manual_category?: boolean | null
          last_seen_at?: string | null
          merchant?: string | null
          merchant_logo_url?: string | null
          needs_review?: boolean | null
          occurred_at?: string | null
          other_account?: string | null
          particulars?: string | null
          raw?: Json | null
          reference?: string | null
        }
        Update: {
          account_id?: string | null
          akahu_category_id?: string | null
          akahu_merchant_id?: string | null
          akahu_transaction_id?: string | null
          akahu_type?: string | null
          amount?: number | null
          balance_after?: number | null
          card_suffix?: string | null
          category_id?: string | null
          code?: string | null
          conversion?: Json | null
          created_at?: string | null
          description?: string | null
          household_id?: string | null
          id?: string | null
          is_manual_category?: boolean | null
          last_seen_at?: string | null
          merchant?: string | null
          merchant_logo_url?: string | null
          needs_review?: boolean | null
          occurred_at?: string | null
          other_account?: string | null
          particulars?: string | null
          raw?: Json | null
          reference?: string | null
        }
        Relationships: []
      }
      expected_inflows: {
        Row: {
          akahu_account_id: string
          created_at: string
          expected_date: string | null
          household_id: string
          id: string
          likelihood: string
          pre_tax: boolean
          tax_rate: number
        }
        Insert: {
          akahu_account_id: string
          created_at?: string
          expected_date?: string | null
          household_id: string
          id?: string
          likelihood?: string
          pre_tax?: boolean
          tax_rate?: number
        }
        Update: {
          akahu_account_id?: string
          created_at?: string
          expected_date?: string | null
          household_id?: string
          id?: string
          likelihood?: string
          pre_tax?: boolean
          tax_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "expected_inflows_akahu_account_id_fkey"
            columns: ["akahu_account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["akahu_account_id"]
          },
          {
            foreignKeyName: "expected_inflows_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      holdings: {
        Row: {
          account_id: string
          cost_basis: number | null
          currency: string
          first_seen: string
          first_seen_observed: boolean
          fund_id: string
          household_id: string
          id: string
          logo: string | null
          name: string
          returns: number | null
          shares: number | null
          symbol: string | null
          updated_at: string
          value: number | null
        }
        Insert: {
          account_id: string
          cost_basis?: number | null
          currency: string
          first_seen?: string
          first_seen_observed?: boolean
          fund_id: string
          household_id: string
          id?: string
          logo?: string | null
          name: string
          returns?: number | null
          shares?: number | null
          symbol?: string | null
          updated_at?: string
          value?: number | null
        }
        Update: {
          account_id?: string
          cost_basis?: number | null
          currency?: string
          first_seen?: string
          first_seen_observed?: boolean
          fund_id?: string
          household_id?: string
          id?: string
          logo?: string | null
          name?: string
          returns?: number | null
          shares?: number | null
          symbol?: string | null
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "holdings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          created_at: string
          household_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      mortgage_parts: {
        Row: {
          account_id: string | null
          created_at: string
          fixed_until: string | null
          household_id: string
          id: string
          kind: string
          label: string
          notes: string | null
          rate: number | null
          repayment: number | null
          repayment_freq: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          fixed_until?: string | null
          household_id: string
          id?: string
          kind?: string
          label: string
          notes?: string | null
          rate?: number | null
          repayment?: number | null
          repayment_freq?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          fixed_until?: string | null
          household_id?: string
          id?: string
          kind?: string
          label?: string
          notes?: string | null
          rate?: number | null
          repayment?: number | null
          repayment_freq?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mortgage_parts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortgage_parts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      net_worth_snapshots: {
        Row: {
          assets: number
          breakdown: Json
          created_at: string
          household_id: string
          id: string
          liabilities: number
          net: number
          snapshot_date: string
        }
        Insert: {
          assets: number
          breakdown?: Json
          created_at?: string
          household_id: string
          id?: string
          liabilities: number
          net: number
          snapshot_date: string
        }
        Update: {
          assets?: number
          breakdown?: Json
          created_at?: string
          household_id?: string
          id?: string
          liabilities?: number
          net?: number
          snapshot_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "net_worth_snapshots_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_refresh_tokens: {
        Row: {
          created_at: string
          expires_at: string
          household_id: string
          jti: string
          rotated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          household_id: string
          jti: string
          rotated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          household_id?: string
          jti?: string
          rotated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      oauth_used_codes: {
        Row: {
          jti: string
          used_at: string
        }
        Insert: {
          jti: string
          used_at?: string
        }
        Update: {
          jti?: string
          used_at?: string
        }
        Relationships: []
      }
      pending_transactions: {
        Row: {
          account_id: string
          akahu_type: string
          amount: number
          description: string | null
          household_id: string
          id: string
          last_seen_at: string
          occurred_at: string
          raw: Json
        }
        Insert: {
          account_id: string
          akahu_type: string
          amount: number
          description?: string | null
          household_id: string
          id?: string
          last_seen_at?: string
          occurred_at: string
          raw: Json
        }
        Update: {
          account_id?: string
          akahu_type?: string
          amount?: number
          description?: string | null
          household_id?: string
          id?: string
          last_seen_at?: string
          occurred_at?: string
          raw?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pending_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_allowlist: {
        Row: {
          added_at: string
          email: string
          note: string | null
        }
        Insert: {
          added_at?: string
          email: string
          note?: string | null
        }
        Update: {
          added_at?: string
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          amount: number
          amount_max: number
          amount_min: number
          cadence: string
          category_id: string | null
          created_at: string
          display_name: string
          first_seen: string
          household_id: string
          id: string
          last_duplicate_window: string | null
          last_seen: string
          merchant_key: string
          next_expected: string
          occurrences: number
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          amount_max: number
          amount_min: number
          cadence: string
          category_id?: string | null
          created_at?: string
          display_name: string
          first_seen: string
          household_id: string
          id?: string
          last_duplicate_window?: string | null
          last_seen: string
          merchant_key: string
          next_expected: string
          occurrences: number
          status: string
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_max?: number
          amount_min?: number
          cadence?: string
          category_id?: string | null
          created_at?: string
          display_name?: string
          first_seen?: string
          household_id?: string
          id?: string
          last_duplicate_window?: string | null
          last_seen?: string
          merchant_key?: string
          next_expected?: string
          occurrences?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_pending_actions: {
        Row: {
          action: Json
          chat_id: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          household_id: string
          id: string
          message_id: number | null
          summary: string
        }
        Insert: {
          action: Json
          chat_id: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          household_id: string
          id?: string
          message_id?: number | null
          summary: string
        }
        Update: {
          action?: Json
          chat_id?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          household_id?: string
          id?: string
          message_id?: number | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_pending_actions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          akahu_category_id: string | null
          akahu_merchant_id: string | null
          akahu_transaction_id: string
          akahu_type: string
          amount: number
          balance_after: number | null
          card_suffix: string | null
          category_id: string | null
          code: string | null
          conversion: Json | null
          created_at: string
          description: string | null
          household_id: string
          id: string
          is_manual_category: boolean
          last_seen_at: string
          merchant: string | null
          merchant_logo_url: string | null
          needs_review: boolean
          occurred_at: string
          other_account: string | null
          particulars: string | null
          raw: Json
          reference: string | null
        }
        Insert: {
          account_id: string
          akahu_category_id?: string | null
          akahu_merchant_id?: string | null
          akahu_transaction_id: string
          akahu_type: string
          amount: number
          balance_after?: number | null
          card_suffix?: string | null
          category_id?: string | null
          code?: string | null
          conversion?: Json | null
          created_at?: string
          description?: string | null
          household_id: string
          id?: string
          is_manual_category?: boolean
          last_seen_at?: string
          merchant?: string | null
          merchant_logo_url?: string | null
          needs_review?: boolean
          occurred_at: string
          other_account?: string | null
          particulars?: string | null
          raw: Json
          reference?: string | null
        }
        Update: {
          account_id?: string
          akahu_category_id?: string | null
          akahu_merchant_id?: string | null
          akahu_transaction_id?: string
          akahu_type?: string
          amount?: number
          balance_after?: number | null
          card_suffix?: string | null
          category_id?: string | null
          code?: string | null
          conversion?: Json | null
          created_at?: string
          description?: string | null
          household_id?: string
          id?: string
          is_manual_category?: boolean
          last_seen_at?: string
          merchant?: string | null
          merchant_logo_url?: string | null
          needs_review?: boolean
          occurred_at?: string
          other_account?: string | null
          particulars?: string | null
          raw?: Json
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_akahu_category_id_fkey"
            columns: ["akahu_category_id"]
            isOneToOne: false
            referencedRelation: "akahu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
