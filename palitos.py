import tkinter as tk
from tkinter import messagebox

# Configuración inicial de las filas de palos (3 filas)
initial_rows = [3, 5, 7]
rows = initial_rows.copy()
selected_sticks = [0, 0, 0]  # Para llevar un conteo de los palos seleccionados por fila
current_row = None
is_player_turn = True  # Variable para controlar el turno
starting_player = None  # Almacena quién comienza

# Lista para guardar los botones de los palos
stick_buttons = [[], [], []]

# Función para calcular el nim-sum
def calculate_nim_sum():
    nim_sum = 0
    for row in rows:
        nim_sum ^= row
    return nim_sum

# Actualiza la representación de las filas en la interfaz gráfica
def update_display():
    for i in range(3):  # 3 filas
        for widget in row_frames[i].winfo_children():
            widget.destroy()
        stick_buttons[i] = []  # Resetear botones para esa fila
        for j in range(rows[i]):
            # Crear un espacio visual para el "palo"
            canvas = tk.Canvas(row_frames[i], width=10, height=60, bg="lightyellow", highlightthickness=0)
            canvas.pack(side=tk.LEFT, padx=2)

            btn = tk.Button(row_frames[i], command=lambda r=i, idx=j: select_stick(r, idx), 
                            bg="lightblue", relief=tk.RAISED)
            btn.pack(side=tk.LEFT, padx=2)
            stick_buttons[i].append(btn)  # Guardar referencia al botón del palo
    update_selected_display()
    turn_label.config(text="Turno del Jugador" if is_player_turn else "Turno de Don Rogelio", font=("Helvetica", 16, "bold"))
    window.update_idletasks()  # Refrescar la pantalla para mostrar los cambios visuales

# Actualiza la visualización de la cantidad de palos seleccionados en cada fila
def update_selected_display():
    for i in range(3):  # 3 filas
        selected_labels[i].config(text=f"Seleccionados en fila {i + 1}: {selected_sticks[i]}", font=("Helvetica", 12))

# Función para seleccionar palos
def select_stick(row, index):
    global current_row
    if is_player_turn:
        if current_row is None or current_row == row:
            if selected_sticks[row] < rows[row]:
                selected_sticks[row] += 1
                current_row = row
                # Desactivar visualmente el palo seleccionado
                stick_buttons[row][index].config(state=tk.DISABLED, bg="gray")
        else:
            messagebox.showwarning("Advertencia", "Solo puedes seleccionar palos de una fila por turno.")

# Función para confirmar la eliminación de los palos seleccionados
def confirm_turn():
    global current_row, is_player_turn
    if not is_player_turn:
        messagebox.showwarning("Advertencia", "No es tu turno.")
        return
    if sum(selected_sticks) == 0:
        messagebox.showwarning("Advertencia", "Debes seleccionar al menos un palo para quitar.")
        return

    for i in range(3):  # 3 filas
        rows[i] -= selected_sticks[i]
        selected_sticks[i] = 0
    current_row = None
    update_display()

    # Verifica si el jugador ha quitado el último palo
    if sum(rows) == 0:
        messagebox.showinfo("Derrota", "¡Has perdido! Has quitado el último palo.")
        window.quit()
    else:
        is_player_turn = False  # Cambiar turno al computador
        window.after(1000, computer_turn)

# Turno del computador
def computer_turn():
    global is_player_turn
    nim_sum = calculate_nim_sum()

    # Filas con más de 0 palitos
    non_zero_rows = [(i, row) for i, row in enumerate(rows) if row > 0]

    # Estrategia del computador: Si quedan dos filas y una de ellas tiene solo 1 palo
    if len(non_zero_rows) == 2:
        i1, row1 = non_zero_rows[0]
        i2, row2 = non_zero_rows[1]
        
        if row1 == row2:
            # Si ambas filas tienen la misma cantidad de palos, quitar 1 de cualquiera
            rows[i1] -= 1
        elif row1 == 1 or row2 == 1:
            # El computador quita todos los palos de la fila con más de 1 palo
            if row1 > 1:
                rows[i1] = 0
            else:
                rows[i2] = 0
        else:
            # Si ambas filas tienen más de 1 palo, las iguala
            if row1 > row2:
                rows[i1] = row2
            else:
                rows[i2] = row1
    else:
        # Estrategia básica: Si nim_sum no es 0, ajustar una fila
        if nim_sum != 0:
            for i, row in non_zero_rows:
                target_row = row ^ nim_sum
                if target_row < row:
                    rows[i] = target_row
                    break
        else:
            # Si nim_sum ya es 0, quitar un palo cualquiera
            i, row = non_zero_rows[0]
            rows[i] -= 1

    update_display()

    # Verifica si el computador ha quitado el último palo
    if sum(rows) == 0:
        messagebox.showinfo("Victoria", "¡Has ganado! Don Rogelio ha quitado el último palo.")
        window.quit()
    else:
        is_player_turn = True  # Cambiar turno al jugador
        update_display()

# Función para configurar quién comienza
def set_player(player):
    global is_player_turn
    global starting_player
    starting_player = player
    if starting_player == "Jugador":
        is_player_turn = True
        turn_label.config(text="Turno del Jugador")
    else:
        is_player_turn = False
        window.after(1000, computer_turn)  # Comenzar turno del computador

# Ventana para seleccionar quién comienza
def choose_starting_player():
    starting_player_window = tk.Toplevel(window)
    starting_player_window.title("¿Quién comienza?")
    starting_player_window.geometry("300x150")
    
    label = tk.Label(starting_player_window, text="Elige quién comienza:", font=("Helvetica", 14))
    label.pack(pady=10)

    player_button = tk.Button(starting_player_window, text="Jugador", command=lambda: [set_player("Jugador"), starting_player_window.destroy()], font=("Helvetica", 12))
    player_button.pack(pady=5)

    computer_button = tk.Button(starting_player_window, text="Don Rogelio", command=lambda: [set_player("Don Rogelio"), starting_player_window.destroy()], font=("Helvetica", 12))
    computer_button.pack(pady=5)

# Crear la ventana principal
window = tk.Tk()
window.title("Juego Nim")
window.geometry("400x600")
window.config(bg="lightyellow")

# Crear frames para cada fila
row_frames = [tk.Frame(window, bg="lightyellow") for _ in range(3)]
for frame in row_frames:
    frame.pack(pady=10)

# Crear etiquetas para mostrar la cantidad de palos seleccionados en cada fila
selected_labels = [tk.Label(window, text=f"Seleccionados en fila {i + 1}: 0", font=("Helvetica", 12)) for i in range(3)]
for label in selected_labels:
    label.pack()

# Etiqueta para indicar el turno
turn_label = tk.Label(window, text="", font=("Helvetica", 16, "bold"), bg="lightyellow")
turn_label.pack(pady=10)

# Botón para confirmar la eliminación de palos seleccionados
confirm_button = tk.Button(window, text="Confirmar Selección", command=confirm_turn, font=("Helvetica", 12), bg="lightgreen")
confirm_button.pack(pady=10)

# Mostrar la ventana para elegir quién comienza
choose_starting_player()

# Inicializar la visualización de los palos
update_display()

window.mainloop()

