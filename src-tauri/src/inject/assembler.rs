

#![allow(dead_code)]

pub struct Stub {
    is64: bool,
    attach: bool,
    thread_attach_fn: u64,
    root_domain: u64,
    code: Vec<u8>,
}

impl Stub {
    pub fn new(is64: bool) -> Self {
        Stub {
            is64,
            attach: false,
            thread_attach_fn: 0,
            root_domain: 0,
            code: Vec::new(),
        }
    }

    pub fn with_attach(mut self, thread_attach_fn: u64, root_domain: u64) -> Self {
        self.attach = true;
        self.thread_attach_fn = thread_attach_fn;
        self.root_domain = root_domain;
        self
    }

    pub fn build(&self, function: u64, ret_slot: u64, args: &[u64]) -> Vec<u8> {
        if self.is64 {
            self.build64(function, ret_slot, args)
        } else {
            self.build86(function, ret_slot, args)
        }
    }
}

impl Stub {
    fn build64(&self, function: u64, ret_slot: u64, args: &[u64]) -> Vec<u8> {
        let mut c: Vec<u8> = Vec::new();

        c.extend_from_slice(&[0x48, 0x83, 0xEC, 0x28]);
        if self.attach {
            c.extend_from_slice(&[0x48, 0xB8]);
            c.extend_from_slice(&self.thread_attach_fn.to_le_bytes());
            c.extend_from_slice(&[0x48, 0xB9]);
            c.extend_from_slice(&self.root_domain.to_le_bytes());
            c.extend_from_slice(&[0xFF, 0xD0]);
        }
        c.extend_from_slice(&[0x48, 0xB8]);
        c.extend_from_slice(&function.to_le_bytes());
        for (i, &a) in args.iter().take(4).enumerate() {
            let op: [u8; 2] = match i {
                0 => [0x48, 0xB9],
                1 => [0x48, 0xBA],
                2 => [0x49, 0xB8],
                _ => [0x49, 0xB9],
            };
            c.extend_from_slice(&op);
            c.extend_from_slice(&a.to_le_bytes());
        }
        c.extend_from_slice(&[0xFF, 0xD0]);
        c.extend_from_slice(&[0x48, 0x83, 0xC4, 0x28]);
        c.extend_from_slice(&[0x48, 0xA3]);
        c.extend_from_slice(&ret_slot.to_le_bytes());
        c.push(0xC3);
        c
    }

    fn build86(&self, function: u64, ret_slot: u64, args: &[u64]) -> Vec<u8> {
        let mut c: Vec<u8> = Vec::new();
        if self.attach {
            c.push(0x68);
            c.extend_from_slice(&(self.root_domain as u32).to_le_bytes());
            c.push(0xB8);
            c.extend_from_slice(&(self.thread_attach_fn as u32).to_le_bytes());
            c.extend_from_slice(&[0xFF, 0xD0]);
            c.extend_from_slice(&[0x83, 0xC4, 0x04]);
        }

        for &a in args.iter().rev() {
            c.push(0x68);
            c.extend_from_slice(&(a as u32).to_le_bytes());
        }
        c.push(0xB8);
        c.extend_from_slice(&(function as u32).to_le_bytes());
        c.extend_from_slice(&[0xFF, 0xD0]);
        if !args.is_empty() {
            c.extend_from_slice(&[0x83, 0xC4, (args.len() * 4) as u8]);
        }
        c.push(0xA3);
        c.extend_from_slice(&(ret_slot as u32).to_le_bytes());
        c.push(0xC3);
        c
    }
}
