"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { PlusIcon, FileTextIcon, UserPlusIcon, HouseIcon, InboxIcon, MoonIcon, LogOutIcon } from "lucide-react"

export function Pattern() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline">
        Quick Actions
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command className="**:data-[selected=true]:bg-muted **:data-selected:bg-transparent">
          <CommandInput placeholder="What do you need?" />
          <CommandList>
            <CommandEmpty>No actions found.</CommandEmpty>
            <CommandGroup heading="Create">
              <CommandItem>
                <PlusIcon
                />
                <span>New Project</span>
                <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem>
                <FileTextIcon
                />
                <span>New Document</span>
                <CommandShortcut>⌘⇧N</CommandShortcut>
              </CommandItem>
              <CommandItem>
                <UserPlusIcon
                />
                <span>Invite Member</span>
                <CommandShortcut>⌘I</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Navigate">
              <CommandItem>
                <HouseIcon
                />
                <span>Go to Dashboard</span>
                <CommandShortcut>⌘D</CommandShortcut>
              </CommandItem>
              <CommandItem>
                <InboxIcon
                />
                <span>Go to Inbox</span>
                <CommandShortcut>⌘⇧I</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="System">
              <CommandItem>
                <MoonIcon
                />
                <span>Toggle Dark Mode</span>
                <CommandShortcut>⌘⇧D</CommandShortcut>
              </CommandItem>
              <CommandItem>
                <LogOutIcon
                />
                <span>Sign Out</span>
                <CommandShortcut>⌘Q</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}