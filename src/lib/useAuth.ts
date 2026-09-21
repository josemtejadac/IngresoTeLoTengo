import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from '../types'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function loadProfile(userId: string) {
      const { data } = await supabase
        .from('ingreso_profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (active) setProfile((data as Profile) ?? null)
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session) {
        loadProfile(data.session.user.id).finally(() => active && setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession) {
        loadProfile(newSession.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return { session, profile, loading }
}
