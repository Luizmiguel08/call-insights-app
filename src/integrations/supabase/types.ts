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
      app_settings: {
        Row: {
          id: string
          meta_daily: number
          updated_at: string
        }
        Insert: {
          id?: string
          meta_daily?: number
          updated_at?: string
        }
        Update: {
          id?: string
          meta_daily?: number
          updated_at?: string
        }
        Relationships: []
      }
      broker_pauses: {
        Row: {
          broker_id: string
          created_at: string
          duration_seconds: number
          ended_at: string | null
          id: string
          reason: string
          session_id: string
          started_at: string
        }
        Insert: {
          broker_id: string
          created_at?: string
          duration_seconds?: number
          ended_at?: string | null
          id?: string
          reason: string
          session_id: string
          started_at?: string
        }
        Update: {
          broker_id?: string
          created_at?: string
          duration_seconds?: number
          ended_at?: string | null
          id?: string
          reason?: string
          session_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_pauses_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_pauses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "broker_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_sessions: {
        Row: {
          broker_id: string
          created_at: string
          ended_at: string | null
          id: string
          started_at: string
        }
        Insert: {
          broker_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          started_at?: string
        }
        Update: {
          broker_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_sessions_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      brokers: {
        Row: {
          approved: boolean
          color: string
          created_at: string
          email: string | null
          id: string
          name: string
          user_id: string | null
        }
        Insert: {
          approved?: boolean
          color?: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          user_id?: string | null
        }
        Update: {
          approved?: boolean
          color?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      calls: {
        Row: {
          attended: boolean
          broker_id: string
          client_name: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          duration_seconds: number
          ended_at: string | null
          id: string
          notes: string | null
          outcome: Database["public"]["Enums"]["call_outcome"] | null
          phone: string | null
          scheduled: boolean
          started_at: string | null
        }
        Insert: {
          attended?: boolean
          broker_id: string
          client_name: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_seconds?: number
          ended_at?: string | null
          id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          phone?: string | null
          scheduled?: boolean
          started_at?: string | null
        }
        Update: {
          attended?: boolean
          broker_id?: string
          client_name?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_seconds?: number
          ended_at?: string | null
          id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          phone?: string | null
          scheduled?: boolean
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts_queue: {
        Row: {
          broker_id: string | null
          call_attempts: number
          created_at: string
          created_by: string | null
          id: string
          last_called_at: string | null
          list_name: string
          name: string
          notes: string | null
          phone: string
          priority: number
          status: string
        }
        Insert: {
          broker_id?: string | null
          call_attempts?: number
          created_at?: string
          created_by?: string | null
          id?: string
          last_called_at?: string | null
          list_name?: string
          name: string
          notes?: string | null
          phone: string
          priority?: number
          status?: string
        }
        Update: {
          broker_id?: string | null
          call_attempts?: number
          created_at?: string
          created_by?: string | null
          id?: string
          last_called_at?: string | null
          list_name?: string
          name?: string
          notes?: string | null
          phone?: string
          priority?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_queue_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      queue_reconciliation_log: {
        Row: {
          auto_fixed: boolean
          broker_id: string | null
          contact_id: string
          contact_name: string | null
          details: Json | null
          expected_attempts: number
          expected_status: string
          id: string
          ran_at: string
          resolved: boolean
          stored_attempts: number
          stored_status: string
          total_calls: number
        }
        Insert: {
          auto_fixed?: boolean
          broker_id?: string | null
          contact_id: string
          contact_name?: string | null
          details?: Json | null
          expected_attempts: number
          expected_status: string
          id?: string
          ran_at?: string
          resolved: boolean
          stored_attempts: number
          stored_status: string
          total_calls: number
        }
        Update: {
          auto_fixed?: boolean
          broker_id?: string | null
          contact_id?: string
          contact_name?: string | null
          details?: Json | null
          expected_attempts?: number
          expected_status?: string
          id?: string
          ran_at?: string
          resolved?: boolean
          stored_attempts?: number
          stored_status?: string
          total_calls?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_clear_contacts: {
        Args: {
          _broker_id?: string
          _include_general?: boolean
          _list_name?: string
          _only_done?: boolean
        }
        Returns: Json
      }
      admin_run_queue_reconciliation: { Args: never; Returns: Json }
      broker_contact_lists: {
        Args: { _broker?: string }
        Returns: {
          done: number
          list_name: string
          pending: number
          skipped: number
          total: number
        }[]
      }
      broker_daily_counts: {
        Args: { _broker: string; _date?: string }
        Returns: Json
      }
      current_broker_id: { Args: never; Returns: string }
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"]; _uid: string }
        Returns: boolean
      }
      next_contact_for_broker: {
        Args: { _broker: string; _list_name?: string }
        Returns: {
          broker_id: string | null
          call_attempts: number
          created_at: string
          created_by: string | null
          id: string
          last_called_at: string | null
          list_name: string
          name: string
          notes: string | null
          phone: string
          priority: number
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recent_queue_mismatches: {
        Args: { _limit?: number }
        Returns: {
          auto_fixed: boolean
          broker_id: string | null
          contact_id: string
          contact_name: string | null
          details: Json | null
          expected_attempts: number
          expected_status: string
          id: string
          ran_at: string
          resolved: boolean
          stored_attempts: number
          stored_status: string
          total_calls: number
        }[]
        SetofOptions: {
          from: "*"
          to: "queue_reconciliation_log"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reconcile_contact_queue: { Args: never; Returns: Json }
      record_call_outcome: {
        Args: {
          _attended: boolean
          _contact_id: string
          _duration_seconds?: number
          _ended_at?: string
          _notes?: string
          _scheduled: boolean
          _started_at?: string
        }
        Returns: Json
      }
      sync_contact_queue_from_calls: {
        Args: { _contact_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "corretor"
      call_outcome:
        | "attended"
        | "no_answer"
        | "voicemail"
        | "wrong_number"
        | "callback"
        | "not_interested"
        | "scheduled"
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
    Enums: {
      app_role: ["admin", "corretor"],
      call_outcome: [
        "attended",
        "no_answer",
        "voicemail",
        "wrong_number",
        "callback",
        "not_interested",
        "scheduled",
      ],
    },
  },
} as const
