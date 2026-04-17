export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      agent_versions: {
        Row: {
          agent_id: string
          created_at: string
          created_by: string | null
          id: string
          snapshot: Json
          version: number
        }
        Insert: {
          agent_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          snapshot: Json
          version: number
        }
        Update: {
          agent_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_versions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          created_at: string
          current_version: number
          first_message: string
          id: string
          llm_config: Json
          llm_fallback_provider: string | null
          llm_provider: string
          name: string
          stt_config: Json
          stt_provider: string
          system_prompt: string
          tenant_id: string
          tts_config: Json
          tts_provider: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_version?: number
          first_message?: string
          id?: string
          llm_config?: Json
          llm_fallback_provider?: string | null
          llm_provider: string
          name: string
          stt_config?: Json
          stt_provider: string
          system_prompt?: string
          tenant_id: string
          tts_config?: Json
          tts_provider: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_version?: number
          first_message?: string
          id?: string
          llm_config?: Json
          llm_fallback_provider?: string | null
          llm_provider?: string
          name?: string
          stt_config?: Json
          stt_provider?: string
          system_prompt?: string
          tenant_id?: string
          tts_config?: Json
          tts_provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          id: number
          occurred_at: string
          target_id: string | null
          target_table: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          id?: number
          occurred_at?: string
          target_id?: string | null
          target_table: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          id?: number
          occurred_at?: string
          target_id?: string | null
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      call_events: {
        Row: {
          call_id: string
          id: number
          kind: string
          occurred_at: string
          payload: Json
        }
        Insert: {
          call_id: string
          id?: number
          kind: string
          occurred_at?: string
          payload?: Json
        }
        Update: {
          call_id?: string
          id?: number
          kind?: string
          occurred_at?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "call_events_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      call_events_default: {
        Row: {
          call_id: string
          id: number
          kind: string
          occurred_at: string
          payload: Json
        }
        Insert: {
          call_id: string
          id?: number
          kind: string
          occurred_at?: string
          payload?: Json
        }
        Update: {
          call_id?: string
          id?: number
          kind?: string
          occurred_at?: string
          payload?: Json
        }
        Relationships: []
      }
      call_events_p20260101: {
        Row: {
          call_id: string
          id: number
          kind: string
          occurred_at: string
          payload: Json
        }
        Insert: {
          call_id: string
          id?: number
          kind: string
          occurred_at?: string
          payload?: Json
        }
        Update: {
          call_id?: string
          id?: number
          kind?: string
          occurred_at?: string
          payload?: Json
        }
        Relationships: []
      }
      call_events_p20260201: {
        Row: {
          call_id: string
          id: number
          kind: string
          occurred_at: string
          payload: Json
        }
        Insert: {
          call_id: string
          id?: number
          kind: string
          occurred_at?: string
          payload?: Json
        }
        Update: {
          call_id?: string
          id?: number
          kind?: string
          occurred_at?: string
          payload?: Json
        }
        Relationships: []
      }
      call_events_p20260301: {
        Row: {
          call_id: string
          id: number
          kind: string
          occurred_at: string
          payload: Json
        }
        Insert: {
          call_id: string
          id?: number
          kind: string
          occurred_at?: string
          payload?: Json
        }
        Update: {
          call_id?: string
          id?: number
          kind?: string
          occurred_at?: string
          payload?: Json
        }
        Relationships: []
      }
      call_events_p20260401: {
        Row: {
          call_id: string
          id: number
          kind: string
          occurred_at: string
          payload: Json
        }
        Insert: {
          call_id: string
          id?: number
          kind: string
          occurred_at?: string
          payload?: Json
        }
        Update: {
          call_id?: string
          id?: number
          kind?: string
          occurred_at?: string
          payload?: Json
        }
        Relationships: []
      }
      call_events_p20260501: {
        Row: {
          call_id: string
          id: number
          kind: string
          occurred_at: string
          payload: Json
        }
        Insert: {
          call_id: string
          id?: number
          kind: string
          occurred_at?: string
          payload?: Json
        }
        Update: {
          call_id?: string
          id?: number
          kind?: string
          occurred_at?: string
          payload?: Json
        }
        Relationships: []
      }
      call_events_p20260601: {
        Row: {
          call_id: string
          id: number
          kind: string
          occurred_at: string
          payload: Json
        }
        Insert: {
          call_id: string
          id?: number
          kind: string
          occurred_at?: string
          payload?: Json
        }
        Update: {
          call_id?: string
          id?: number
          kind?: string
          occurred_at?: string
          payload?: Json
        }
        Relationships: []
      }
      call_events_p20260701: {
        Row: {
          call_id: string
          id: number
          kind: string
          occurred_at: string
          payload: Json
        }
        Insert: {
          call_id: string
          id?: number
          kind: string
          occurred_at?: string
          payload?: Json
        }
        Update: {
          call_id?: string
          id?: number
          kind?: string
          occurred_at?: string
          payload?: Json
        }
        Relationships: []
      }
      calls: {
        Row: {
          agent_id: string
          agent_version_snapshot: Json
          created_at: string
          direction: string
          duration_seconds: number | null
          end_reason: string | null
          ended_at: string | null
          from_number: string
          id: string
          recording_object_path: string | null
          recording_pulled_at: string | null
          started_at: string | null
          status: string
          tenant_id: string
          to_number: string
          transcript_json: Json | null
          transcript_tsv: unknown
          twilio_call_sid: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          agent_version_snapshot: Json
          created_at?: string
          direction: string
          duration_seconds?: number | null
          end_reason?: string | null
          ended_at?: string | null
          from_number: string
          id?: string
          recording_object_path?: string | null
          recording_pulled_at?: string | null
          started_at?: string | null
          status?: string
          tenant_id: string
          to_number: string
          transcript_json?: Json | null
          transcript_tsv?: unknown
          twilio_call_sid: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          agent_version_snapshot?: Json
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          end_reason?: string | null
          ended_at?: string | null
          from_number?: string
          id?: string
          recording_object_path?: string | null
          recording_pulled_at?: string | null
          started_at?: string | null
          status?: string
          tenant_id?: string
          to_number?: string
          transcript_json?: Json | null
          transcript_tsv?: unknown
          twilio_call_sid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_jobs: {
        Row: {
          agent_id: string
          call_id: string | null
          cloud_task_name: string | null
          context: Json
          created_at: string
          id: string
          status: string
          tenant_id: string
          to_phone: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          call_id?: string | null
          cloud_task_name?: string | null
          context?: Json
          created_at?: string
          id?: string
          status?: string
          tenant_id: string
          to_phone: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          call_id?: string | null
          cloud_task_name?: string | null
          context?: Json
          created_at?: string
          id?: string
          status?: string
          tenant_id?: string
          to_phone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_jobs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_jobs_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          concurrency_cap: number
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          concurrency_cap?: number
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          concurrency_cap?: number
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      twilio_numbers: {
        Row: {
          agent_id: string | null
          created_at: string
          direction: string
          id: string
          phone_number: string
          tenant_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          direction: string
          id?: string
          phone_number: string
          tenant_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          direction?: string
          id?: string
          phone_number?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "twilio_numbers_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "twilio_numbers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
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

