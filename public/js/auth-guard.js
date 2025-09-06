<!-- /public/js/auth-guard.js -->
<script type="module">
  import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

  // === CONFIG ===
  const SUPABASE_URL = "https://tcfmeggqhxcnihkmnkqs.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjZm1lZ2dxaHhjbmloa21ua3FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTAzMjUsImV4cCI6MjA3Mjc2NjMyNX0.VYkrvIVWti57W9UOnQcCvywmonWGyrtIT4KAzszbiFs";

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function getProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { user: null, profile: null };
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id, full_name, role, avatar_url")
      .eq("user_id", user.id)
      .single();
    return { user, profile };
  }

  // Requiere login (cualquier rol); retorna {user, profile}
  async function requireAuth() {
    const { user, profile } = await getProfile();
    if (!user) {
      location.href = "/login.html";
      throw new Error("not_authenticated");
    }
    return { user, profile };
  }

  // Requiere rol específico (o uno de varios)
  async function requireRole(roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    const { user, profile } = await requireAuth();
    if (!profile || !allowed.includes(profile.role)) {
      // Redirección inteligente por rol
      if (profile?.role === "manager") location.href = "/admin.html";
      else location.href = "/employee.html";
      throw new Error("forbidden");
    }
    return { user, profile };
  }

  async function logout() {
    await supabase.auth.signOut();
    location.href = "/login.html";
  }

  // Exponer en window para uso sencillo
  window.CREMA_AUTH = {
    supabase,
    getProfile,
    requireAuth,
    requireRole,
    logout
  };
</script>