"use client";

import {
  GamepadIcon,
  MessageSquareIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { deleteChat, type StoredChat, useChats } from "@/lib/chats";

export function ChatSidebar({
  activeChatId,
  onNewChat,
  onOpenChat,
}: {
  activeChatId: string;
  onNewChat: () => void;
  onOpenChat: (chat: StoredChat) => void;
}) {
  const chats = useChats();
  return (
    <Sidebar>
      <SidebarHeader>
        <p className="px-2 py-1 font-semibold tracking-tight">
          Game<span className="text-primary">Atlas</span>
        </p>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onNewChat}>
              <PlusIcon />
              New chat
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Chats</SidebarGroupLabel>
          <SidebarGroupContent>
            {chats.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                Your chats show up here. They stay in this browser.
              </p>
            ) : (
              <SidebarMenu>
                {chats.map((chat) => (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton
                      isActive={chat.id === activeChatId}
                      onClick={() => {
                        onOpenChat(chat);
                      }}
                    >
                      {chat.game === null ? (
                        <MessageSquareIcon />
                      ) : (
                        <GamepadIcon />
                      )}
                      <span className="truncate">{chat.title}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      aria-label={`Delete chat “${chat.title}”`}
                      onClick={() => {
                        deleteChat(chat.id);
                      }}
                    >
                      <TrashIcon />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 text-[11px] leading-snug text-muted-foreground">
          Article text from Wikipedia, CC BY-SA 4.0. Places from Wikidata. No
          accounts, no cookies, no request logs. Chats are saved only in this
          browser.
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
