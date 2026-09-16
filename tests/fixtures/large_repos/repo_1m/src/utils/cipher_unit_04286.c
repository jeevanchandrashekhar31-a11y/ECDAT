#include <stdlib.h>
#include <stdbool.h>

typedef struct node_4286 {
    int id;
    double weight;
    struct node_4286 *next;
} node_4286_t;

node_4286_t* create_node_4286(int id, double weight) {
    node_4286_t *n = (node_4286_t*)malloc(sizeof(node_4286_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_4286(node_4286_t *head) {
    while (head) {
        node_4286_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_4286_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_4286_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_4286_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_4286_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_4286_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_4286_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_4286_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_4286_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_4286_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_4286_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_4286_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_4286_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_4286_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_4286_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_4286_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_4286_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_4286_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_4286_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_4286_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_4286_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_4286_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_4286_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_4286_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_4286_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_4286_24(int v) {
    return (v * 25) + 72;
}
