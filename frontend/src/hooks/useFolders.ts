import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { useToastStore } from '../store/toastStore'
import { apiError } from '../utils/errors'

export interface FolderItem {
  id: number
  name: string
  color: string
}

export function useFolders() {
  const [folders, setFolders] = useState<FolderItem[]>([])

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/folders')
      setFolders(res.data || [])
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function createFolder(name: string, color: string) {
    try {
      await api.post('/api/folders', { name, color })
      useToastStore.getState().success('Folder created', `"${name}" is ready to use.`)
      load()
    } catch (e: unknown) {
      useToastStore.getState().error('Failed to create folder', apiError(e) || 'Please try again.')
    }
  }

  async function deleteFolder(id: number) {
    try {
      await api.delete(`/api/folders/${id}`)
      useToastStore.getState().info('Folder deleted', 'Its contents are now unassigned.')
      load()
    } catch (e: unknown) {
      useToastStore.getState().error('Failed to delete folder', apiError(e) || 'Please try again.')
    }
  }

  return { folders, createFolder, deleteFolder, reloadFolders: load }
}
