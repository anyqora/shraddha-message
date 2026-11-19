CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER enforce_account_identity_columns BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION enforce_account_identity_columns();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER ai_configs_updated_at BEFORE UPDATE ON public.ai_configs FOR EACH ROW EXECUTE FUNCTION update_ai_configs_updated_at();
CREATE TRIGGER ai_knowledge_documents_updated_at BEFORE UPDATE ON public.ai_knowledge_documents FOR EACH ROW EXECUTE FUNCTION update_ai_knowledge_documents_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.automations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER broadcast_recipients_aggregate AFTER INSERT OR DELETE OR UPDATE ON public.broadcast_recipients FOR EACH ROW EXECUTE FUNCTION broadcast_recipient_aggregate_trigger();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.broadcasts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER conversations_stamp_closed_at BEFORE INSERT OR UPDATE OF status ON public.conversations FOR EACH ROW EXECUTE FUNCTION stamp_conversation_closed_at();
CREATE TRIGGER enforce_conversation_assignee_membership BEFORE INSERT OR UPDATE OF assigned_agent_id, account_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION enforce_conversation_assignee_membership();
CREATE TRIGGER on_conversation_assigned AFTER INSERT OR UPDATE OF assigned_agent_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION notify_conversation_assigned();
CREATE TRIGGER realtime_notify_trg AFTER INSERT OR DELETE OR UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION realtime_notify('id');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER deals_stamp_closed_at BEFORE INSERT OR UPDATE OF status ON public.deals FOR EACH ROW EXECUTE FUNCTION stamp_deal_closed_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER realtime_notify_trg AFTER INSERT OR DELETE OR UPDATE ON public.flow_runs FOR EACH ROW EXECUTE FUNCTION realtime_notify('id');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.flows FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER realtime_notify_trg AFTER INSERT OR DELETE OR UPDATE ON public.member_presence FOR EACH ROW EXECUTE FUNCTION realtime_notify('user_id');
CREATE TRIGGER realtime_notify_trg AFTER INSERT OR DELETE OR UPDATE ON public.message_reactions FOR EACH ROW EXECUTE FUNCTION realtime_notify('id');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.message_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER messages_track_conversation_times AFTER INSERT OR UPDATE OF status ON public.messages FOR EACH ROW EXECUTE FUNCTION track_conversation_message_times();
CREATE TRIGGER realtime_notify_trg AFTER INSERT OR DELETE OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION realtime_notify('id');
CREATE TRIGGER realtime_notify_trg AFTER INSERT OR DELETE OR UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION realtime_notify('id');
CREATE TRIGGER enforce_profile_privilege_columns BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION enforce_profile_privilege_columns();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.quick_replies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER realtime_notify_trg AFTER INSERT OR DELETE OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION realtime_notify('id');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tasks_stamp_completed_at BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION tasks_stamp_completed_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.views FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- public.account_invitations :: account_invitations_modify [ALL] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: is_account_member(account_id, 'admin'::account_role_enum)
-- public.account_invitations :: account_invitations_select [SELECT] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.accounts :: accounts_select [SELECT] roles={public}
--   USING: is_account_member(id)
--   CHECK: None
-- public.accounts :: accounts_update [UPDATE] roles={public}
--   USING: is_account_member(id, 'admin'::account_role_enum)
--   CHECK: is_account_member(id, 'admin'::account_role_enum)
-- public.ai_configs :: ai_configs_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.ai_configs :: ai_configs_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'admin'::account_role_enum)
-- public.ai_configs :: ai_configs_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.ai_configs :: ai_configs_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.ai_knowledge_chunks :: ai_knowledge_chunks_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.ai_knowledge_chunks :: ai_knowledge_chunks_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'admin'::account_role_enum)
-- public.ai_knowledge_chunks :: ai_knowledge_chunks_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.ai_knowledge_chunks :: ai_knowledge_chunks_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.ai_knowledge_documents :: ai_knowledge_documents_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.ai_knowledge_documents :: ai_knowledge_documents_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'admin'::account_role_enum)
-- public.ai_knowledge_documents :: ai_knowledge_documents_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.ai_knowledge_documents :: ai_knowledge_documents_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.ai_usage_log :: ai_usage_log_select [SELECT] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.api_keys :: api_keys_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.api_keys :: api_keys_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'admin'::account_role_enum)
-- public.api_keys :: api_keys_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.api_keys :: api_keys_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.automation_logs :: automation_logs_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.automation_steps :: automation_steps_modify [ALL] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM automations a
  WHERE ((a.id = automation_steps.automation_id) AND is_account_member(a.account_id, 'agent'::account_role_enum))))
--   CHECK: (EXISTS ( SELECT 1
   FROM automations a
  WHERE ((a.id = automation_steps.automation_id) AND is_account_member(a.account_id, 'agent'::account_role_enum))))
-- public.automation_steps :: automation_steps_select [SELECT] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM automations a
  WHERE ((a.id = automation_steps.automation_id) AND is_account_member(a.account_id))))
--   CHECK: None
-- public.automations :: automations_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.automations :: automations_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'agent'::account_role_enum)
-- public.automations :: automations_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.automations :: automations_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.broadcast_recipients :: broadcast_recipients_modify [ALL] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND is_account_member(b.account_id, 'agent'::account_role_enum))))
--   CHECK: (EXISTS ( SELECT 1
   FROM broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND is_account_member(b.account_id, 'agent'::account_role_enum))))
-- public.broadcast_recipients :: broadcast_recipients_select [SELECT] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND is_account_member(b.account_id))))
--   CHECK: None
-- public.broadcasts :: broadcasts_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.broadcasts :: broadcasts_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'agent'::account_role_enum)
-- public.broadcasts :: broadcasts_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.broadcasts :: broadcasts_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.companies :: companies_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.companies :: companies_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'agent'::account_role_enum)
-- public.companies :: companies_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.companies :: companies_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.contact_custom_values :: contact_custom_values_modify [ALL] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
--   CHECK: (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
-- public.contact_custom_values :: contact_custom_values_select [SELECT] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND is_account_member(c.account_id))))
--   CHECK: None
-- public.contact_notes :: contact_notes_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.contact_notes :: contact_notes_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'agent'::account_role_enum)
-- public.contact_notes :: contact_notes_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.contact_notes :: contact_notes_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.contact_tags :: contact_tags_modify [ALL] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_tags.contact_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
--   CHECK: (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_tags.contact_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
-- public.contact_tags :: contact_tags_select [SELECT] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_tags.contact_id) AND is_account_member(c.account_id))))
--   CHECK: None
-- public.contacts :: contacts_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.contacts :: contacts_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'agent'::account_role_enum)
-- public.contacts :: contacts_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.contacts :: contacts_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.conversations :: conversations_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.conversations :: conversations_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'agent'::account_role_enum)
-- public.conversations :: conversations_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.conversations :: conversations_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.custom_fields :: custom_fields_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.custom_fields :: custom_fields_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'admin'::account_role_enum)
-- public.custom_fields :: custom_fields_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.custom_fields :: custom_fields_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.deals :: deals_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.deals :: deals_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'agent'::account_role_enum)
-- public.deals :: deals_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.deals :: deals_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.flow_nodes :: flow_nodes_modify [ALL] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM flows f
  WHERE ((f.id = flow_nodes.flow_id) AND is_account_member(f.account_id, 'agent'::account_role_enum))))
--   CHECK: (EXISTS ( SELECT 1
   FROM flows f
  WHERE ((f.id = flow_nodes.flow_id) AND is_account_member(f.account_id, 'agent'::account_role_enum))))
-- public.flow_nodes :: flow_nodes_select [SELECT] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM flows f
  WHERE ((f.id = flow_nodes.flow_id) AND is_account_member(f.account_id))))
--   CHECK: None
-- public.flow_run_events :: flow_run_events_select [SELECT] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM flow_runs r
  WHERE ((r.id = flow_run_events.flow_run_id) AND is_account_member(r.account_id))))
--   CHECK: None
-- public.flow_runs :: flow_runs_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.flows :: flows_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.flows :: flows_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'agent'::account_role_enum)
-- public.flows :: flows_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.flows :: flows_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.member_presence :: member_presence_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.message_reactions :: message_reactions_modify [ALL] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
--   CHECK: (EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
-- public.message_reactions :: message_reactions_select [SELECT] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND is_account_member(c.account_id))))
--   CHECK: None
-- public.message_templates :: message_templates_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.message_templates :: message_templates_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'admin'::account_role_enum)
-- public.message_templates :: message_templates_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.message_templates :: message_templates_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.messages :: messages_modify [ALL] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
--   CHECK: (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
-- public.messages :: messages_select [SELECT] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND is_account_member(c.account_id))))
--   CHECK: None
-- public.notifications :: notifications_select [SELECT] roles={public}
--   USING: (auth.uid() = user_id)
--   CHECK: None
-- public.notifications :: notifications_update [UPDATE] roles={public}
--   USING: (auth.uid() = user_id)
--   CHECK: (auth.uid() = user_id)
-- public.pipeline_stages :: pipeline_stages_modify [ALL] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND is_account_member(p.account_id, 'admin'::account_role_enum))))
--   CHECK: (EXISTS ( SELECT 1
   FROM pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND is_account_member(p.account_id, 'admin'::account_role_enum))))
-- public.pipeline_stages :: pipeline_stages_select [SELECT] roles={public}
--   USING: (EXISTS ( SELECT 1
   FROM pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND is_account_member(p.account_id))))
--   CHECK: None
-- public.pipelines :: pipelines_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.pipelines :: pipelines_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'admin'::account_role_enum)
-- public.pipelines :: pipelines_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.pipelines :: pipelines_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.profiles :: profiles_select [SELECT] roles={public}
--   USING: ((auth.uid() = user_id) OR is_account_member(account_id))
--   CHECK: None
-- public.profiles :: profiles_update [UPDATE] roles={public}
--   USING: (auth.uid() = user_id)
--   CHECK: (auth.uid() = user_id)
-- public.quick_replies :: quick_replies_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.quick_replies :: quick_replies_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'agent'::account_role_enum)
-- public.quick_replies :: quick_replies_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.quick_replies :: quick_replies_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.tags :: tags_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.tags :: tags_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'admin'::account_role_enum)
-- public.tags :: tags_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.tags :: tags_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.tasks :: tasks_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.tasks :: tasks_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'agent'::account_role_enum)
-- public.tasks :: tasks_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.tasks :: tasks_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.views :: views_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.views :: views_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'agent'::account_role_enum)
-- public.views :: views_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.views :: views_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'agent'::account_role_enum)
--   CHECK: None
-- public.webhook_endpoints :: webhook_endpoints_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.webhook_endpoints :: webhook_endpoints_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'admin'::account_role_enum)
-- public.webhook_endpoints :: webhook_endpoints_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.webhook_endpoints :: webhook_endpoints_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.whatsapp_config :: whatsapp_config_delete [DELETE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- public.whatsapp_config :: whatsapp_config_insert [INSERT] roles={public}
--   USING: None
--   CHECK: is_account_member(account_id, 'admin'::account_role_enum)
-- public.whatsapp_config :: whatsapp_config_select [SELECT] roles={public}
--   USING: is_account_member(account_id)
--   CHECK: None
-- public.whatsapp_config :: whatsapp_config_update [UPDATE] roles={public}
--   USING: is_account_member(account_id, 'admin'::account_role_enum)
--   CHECK: None
-- storage.objects :: Members can delete chat media [DELETE] roles={public}
--   USING: ((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1])))))
--   CHECK: None
-- storage.objects :: Members can delete flow media [DELETE] roles={public}
--   USING: ((bucket_id = 'flow-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND ((('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]) OR ((auth.uid())::text = (storage.foldername(objects.name))[1]))))))
--   CHECK: None
-- storage.objects :: Members can read chat media [SELECT] roles={authenticated}
--   USING: ((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1])))))
--   CHECK: None
-- storage.objects :: Members can read flow media [SELECT] roles={authenticated}
--   USING: ((bucket_id = 'flow-media'::text) AND ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1])))) OR ((auth.uid())::text = (storage.foldername(name))[1])))
--   CHECK: None
-- storage.objects :: Members can update chat media [UPDATE] roles={public}
--   USING: ((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1])))))
--   CHECK: ((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1])))))
-- storage.objects :: Members can update flow media [UPDATE] roles={public}
--   USING: ((bucket_id = 'flow-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND ((('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]) OR ((auth.uid())::text = (storage.foldername(objects.name))[1]))))))
--   CHECK: ((bucket_id = 'flow-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND ((('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]) OR ((auth.uid())::text = (storage.foldername(objects.name))[1]))))))
-- storage.objects :: Members can upload chat media [INSERT] roles={public}
--   USING: None
--   CHECK: ((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1])))))
-- storage.objects :: Members can upload flow media [INSERT] roles={public}
--   USING: None
--   CHECK: ((bucket_id = 'flow-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND ((('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]) OR ((auth.uid())::text = (storage.foldername(objects.name))[1]))))))
-- storage.objects :: Users can delete their own avatar [DELETE] roles={public}
--   USING: ((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]))
--   CHECK: None
-- storage.objects :: Users can read their own avatar [SELECT] roles={authenticated}
--   USING: ((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]))
--   CHECK: None
-- storage.objects :: Users can update their own avatar [UPDATE] roles={public}
--   USING: ((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]))
--   CHECK: None
-- storage.objects :: Users can upload their own avatar [INSERT] roles={public}
--   USING: None
--   CHECK: ((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]))
