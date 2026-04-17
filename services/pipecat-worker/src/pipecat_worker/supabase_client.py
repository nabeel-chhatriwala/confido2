from supabase import Client, create_client

from .config import Config


def make_client(cfg: Config) -> Client:
    return create_client(cfg.supabase_url, cfg.supabase_service_role_key)
