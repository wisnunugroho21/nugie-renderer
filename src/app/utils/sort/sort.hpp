
// A utility function to swap two elements
template<typename Type>
void swap(Type* a, Type* b) {
	Type t = *a;
	*a = *b;
	*b = t;
}

/* This function is same in both iterative and recursive*/
template<typename Type>
int partition(Type *arr, int l, int h, bool (*comparator)(Type a, Type b)) {
	Type x = arr[h];
	int i = (l - 1);

	for (int j = l; j <= h - 1; j++) {
		if (comparator(arr[j], x)) {
			i++;
			swap<Type>(&arr[i], &arr[j]);
		}
	}

	swap<Type>(&arr[i + 1], &arr[h]);
	return (i + 1);
}

/* A[] --> Array to be sorted,
l --> Starting index,
h --> Ending index */
template<typename Type>
void quickSortIterative(Type *arr, int l, int h, bool (*comparator)(Type a, Type b)) {
  int stackSize = h - l + 1;

	// Create an auxiliary 
  int* stack = (int*) malloc(stackSize * sizeof(int));

	// initialize top of stack
	int top = -1;

	// push initial values of l and h to stack
	stack[++top] = l;
	stack[++top] = h;

	// Keep popping from stack while is not empty
	while (top >= 0) {
		// Pop h and l
		h = stack[top--];
		l = stack[top--];

		// Set pivot element at its correct position
		// in sorted array
		int p = partition<Type>(arr, l, h, comparator);

		// If there are elements on left side of pivot,
		// then push left side to stack
		if (p - 1 > l) {
			stack[++top] = l;
			stack[++top] = p - 1;
		}

		// If there are elements on right side of pivot,
		// then push right side to stack
		if (p + 1 < h) {
			stack[++top] = p + 1;
			stack[++top] = h;
		}
	}
}
